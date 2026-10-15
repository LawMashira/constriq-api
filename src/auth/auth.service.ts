import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, OtpPurpose, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import {
  activateCompanyMembership,
  bootstrapCompanyIdentity,
  companyRegisteredAudit,
} from '../identity/tenant-bootstrap';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing?.status === UserStatus.ACTIVE) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    if (existing && existing.status === UserStatus.INVITED) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { name: dto.name, passwordHash },
      });
      await this.sendOtp(email, existing.id, OtpPurpose.EMAIL_VERIFICATION);
      return {
        message: 'Verification code sent to your email',
        email,
        requiresVerification: true,
      };
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          legalName: dto.companyLegalName,
          tradingName: dto.tradingName,
          country: dto.country ?? 'ZA',
          currency: dto.currency ?? 'ZAR',
          settings: { create: {} },
        },
      });

      const created = await tx.user.create({
        data: {
          companyId: company.id,
          name: dto.name,
          email,
          passwordHash,
          status: UserStatus.INVITED,
        },
      });

      await bootstrapCompanyIdentity(tx, {
        companyId: company.id,
        userId: created.id,
        ownerUserStatus: UserStatus.INVITED,
      });

      await tx.auditLog.create({
        data: {
          companyId: company.id,
          ...companyRegisteredAudit({ companyId: company.id, userId: created.id }),
        },
      });

      return created;
    });

    await this.sendOtp(email, user.id, OtpPurpose.EMAIL_VERIFICATION);

    return {
      message: 'Verification code sent to your email',
      email,
      requiresVerification: true,
    };
  }

  async acceptInvite(dto: { email: string; name: string; password: string }) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== UserStatus.INVITED) {
      throw new BadRequestException('No invitation found for this email');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { name: dto.name, passwordHash },
    });
    await this.sendOtp(email, user.id, OtpPurpose.EMAIL_VERIFICATION);
    return {
      message: 'Verification code sent to your email',
      email,
      requiresVerification: true,
    };
  }

  async verifyEmail(email: string, otp: string, meta?: { ip?: string; userAgent?: string }) {
    const user = await this.requireUser(email);
    await this.consumeOtp(user.email, otp, OtpPurpose.EMAIL_VERIFICATION, user.id);

    const verified = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      await activateCompanyMembership(tx, {
        companyId: updated.companyId,
        userId: updated.id,
      });
      return updated;
    });

    return this.createAuthSession(verified, meta);
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || user.status === UserStatus.ACTIVE) {
      return { message: 'If an unverified account exists, a new code has been sent' };
    }
    await this.sendOtp(user.email, user.id, OtpPurpose.EMAIL_VERIFICATION);
    return { message: 'If an unverified account exists, a new code has been sent' };
  }

  async login(dto: LoginDto, meta?: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === UserStatus.INVITED || !user.emailVerifiedAt) {
      await this.sendOtp(user.email, user.id, OtpPurpose.EMAIL_VERIFICATION);
      throw new UnauthorizedException(
        'Email is not verified. A new verification code has been sent.',
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
    if (user.mfaEnabled) {
      if (!dto.otp) {
        await this.sendOtp(user.email, user.id, OtpPurpose.LOGIN);
        return {
          mfaRequired: true,
          email: user.email,
          message: 'Enter the sign-in code sent to your email',
        };
      }
      await this.consumeOtp(user.email, dto.otp, OtpPurpose.LOGIN, user.id);
    }
    return this.createAuthSession(user, meta);
  }

  async refresh(refreshToken: string, meta?: { ip?: string; userAgent?: string }) {
    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.createAuthSession(session.user, meta);
  }

  async logout(user: AuthUser) {
    await this.prisma.userSession.update({
      where: { id: user.sessionId },
      data: { revokedAt: new Date() },
    });
    return { message: 'Signed out' };
  }

  async logoutAll(user: AuthUser) {
    await this.prisma.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Signed out of all sessions' };
  }

  async me(user: AuthUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        company: {
          select: {
            id: true,
            legalName: true,
            tradingName: true,
            currency: true,
            country: true,
            status: true,
          },
        },
        roles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
        memberships: true,
      },
    });

    return {
      id: record.id,
      name: record.name,
      email: record.email,
      status: record.status,
      emailVerifiedAt: record.emailVerifiedAt,
      mfaEnabled: record.mfaEnabled,
      company: record.company,
      roles: record.roles.map((item) => item.role.systemRole ?? item.role.name),
      permissions: [
        ...new Set(
          record.roles.flatMap((item) =>
            item.role.permissions.map((entry) => entry.permission.code),
          ),
        ),
      ],
      memberships: record.memberships.map((item) => ({
        companyId: item.companyId,
        status: item.status,
      })),
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (user?.status === UserStatus.ACTIVE) {
      await this.sendOtp(user.email, user.id, OtpPurpose.PASSWORD_RESET);
    }
    return { message: 'If an account exists, a reset code has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.requireUser(dto.email);
    await this.consumeOtp(user.email, dto.otp, OtpPurpose.PASSWORD_RESET, user.id);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password updated. Please sign in.' };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (!record.passwordHash) {
      throw new BadRequestException('Password cannot be changed');
    }
    const valid = await bcrypt.compare(dto.currentPassword, record.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: record.id },
      data: { passwordHash },
    });
    return { message: 'Password updated' };
  }

  async enableMfa(user: AuthUser) {
    await this.sendOtp(user.email, user.id, OtpPurpose.LOGIN);
    return { message: 'Enter the code sent to your email to enable MFA' };
  }

  async confirmMfa(user: AuthUser, otp: string) {
    await this.consumeOtp(user.email, otp, OtpPurpose.LOGIN, user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    return { mfaEnabled: true };
  }

  async disableMfa(user: AuthUser, password: string) {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!record.passwordHash || !(await bcrypt.compare(password, record.passwordHash))) {
      throw new UnauthorizedException('Password is incorrect');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null } });
    return { mfaEnabled: false };
  }

  private async createAuthSession(
    user: { id: string; companyId: string; email: string; name: string; status: UserStatus },
    meta?: { ip?: string; userAgent?: string },
  ) {
    const refreshToken = randomBytes(48).toString('hex');
    const refreshDays = Number(this.config.get('JWT_REFRESH_DAYS') ?? 7);
    const session = await this.prisma.userSession.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000),
      },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        action: AuditAction.LOGIN,
        module: 'AUTH',
        entityType: 'COMPANY',
        entityId: user.companyId,
        description: `${user.name} signed in`,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        source: 'USER',
      },
    });

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      companyId: user.companyId,
      email: user.email,
      sessionId: session.id,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Number(this.config.get('JWT_ACCESS_SECONDS') ?? 900),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        companyId: user.companyId,
        status: user.status,
      },
    };
  }

  private async sendOtp(email: string, userId: string, purpose: OtpPurpose) {
    const latest = await this.prisma.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
      throw new BadRequestException('Please wait before requesting another code');
    }

    const code = randomInt(100000, 1000000).toString();
    const minutes = Number(this.config.get('OTP_EXPIRES_MINUTES') ?? 10);

    await this.prisma.emailOtp.create({
      data: {
        email,
        userId,
        purpose,
        codeHash: this.hashOtp(email, purpose, code),
        expiresAt: new Date(Date.now() + minutes * 60 * 1000),
      },
    });

    await this.mail.sendOtp(email, code, purpose);
  }

  private async consumeOtp(
    email: string,
    code: string,
    purpose: OtpPurpose,
    userId: string,
  ) {
    const otp = await this.prisma.emailOtp.findFirst({
      where: { email, purpose, userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new BadRequestException('Invalid or expired verification code');
    }
    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('Verification code has expired');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many invalid attempts. Request a new code.');
    }

    const expected = Buffer.from(otp.codeHash);
    const received = Buffer.from(this.hashOtp(email, purpose, code));
    const matches =
      expected.length === received.length && timingSafeEqual(expected, received);

    if (!matches) {
      await this.prisma.emailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.emailOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  private hashOtp(email: string, purpose: OtpPurpose, code: string) {
    const pepper = this.config.get<string>('OTP_PEPPER') ?? this.config.getOrThrow('JWT_SECRET');
    return createHash('sha256').update(`${pepper}:${email}:${purpose}:${code}`).digest('hex');
  }

  private async requireUser(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired verification code');
    }
    return user;
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
