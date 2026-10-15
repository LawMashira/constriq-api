import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { MembershipStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth.types';

type JwtPayload = {
  sub: string;
  companyId: string;
  email: string;
  sessionId: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: {
          include: {
            company: true,
            memberships: {
              where: { companyId: payload.companyId },
            },
            roles: {
              include: {
                role: {
                  include: { permissions: { include: { permission: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.userId !== payload.sub
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    if (session.user.companyId !== payload.companyId) {
      throw new UnauthorizedException('Tenant does not match this session');
    }

    if (session.user.company.status !== 'ACTIVE') {
      throw new UnauthorizedException('Company is not active');
    }

    const membership = session.user.memberships[0];
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new UnauthorizedException('No active membership for this company');
    }

    const roles = session.user.roles.map(
      (item) => item.role.systemRole ?? item.role.name,
    );
    const permissions = [
      ...new Set(
        session.user.roles.flatMap((item) =>
          item.role.permissions.map((entry) => entry.permission.code),
        ),
      ),
    ];

    return {
      id: session.user.id,
      companyId: session.user.companyId,
      email: session.user.email,
      name: session.user.name,
      status: session.user.status,
      sessionId: session.id,
      roles,
      permissions,
    };
  }
}
