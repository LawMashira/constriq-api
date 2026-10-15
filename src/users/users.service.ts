import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EntityType, MembershipStatus, UserStatus } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { InviteUserDto } from './dto/invite-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  list(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        roles: { include: { role: true } },
        memberships: { where: { companyId } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  listRoles(companyId: string) {
    return this.prisma.roleDefinition.findMany({
      where: { companyId },
      select: { id: true, name: true, systemRole: true },
      orderBy: { name: 'asc' },
    });
  }

  async invite(companyId: string, actorId: string, dto: InviteUserDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const role = await this.prisma.roleDefinition.findFirst({
      where: { id: dto.roleId, companyId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const [company, actor] = await Promise.all([
      this.prisma.company.findFirst({ where: { id: companyId }, select: { legalName: true } }),
      this.prisma.user.findFirst({ where: { id: actorId }, select: { name: true } }),
    ]);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          companyId,
          name: dto.name,
          email,
          status: UserStatus.INVITED,
        },
      });
      await tx.companyMembership.create({
        data: {
          companyId,
          userId: created.id,
          status: MembershipStatus.INVITED,
        },
      });
      await tx.userRole.create({
        data: { userId: created.id, roleId: role.id },
      });
      return created;
    });

    try {
      await this.mail.sendInvite({
        to: email,
        name: dto.name,
        roleName: role.name,
        companyName: company?.legalName ?? 'CONSTRIQ',
        invitedBy: actor?.name ?? 'A teammate',
      });
    } catch {
      // Invitation is stored. They can still open /accept-invite with this email.
    }

    await this.audit.record({
      companyId,
      userId: actorId,
      action: AuditAction.CREATE,
      module: 'USERS',
      entityType: EntityType.USER,
      entityId: user.id,
      description: `Invited ${email} as ${role.name}`,
    });
    return user;
  }

  async assignRole(companyId: string, actorId: string, userId: string, roleId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const role = await this.prisma.roleDefinition.findFirst({
      where: { id: roleId, companyId },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.create({ data: { userId, roleId: role.id } });
    });
    await this.audit.record({
      companyId,
      userId: actorId,
      action: AuditAction.UPDATE,
      module: 'USERS',
      entityType: EntityType.USER,
      entityId: userId,
      description: `Set ${user.email} role to ${role.name}`,
    });
    return this.prisma.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        roles: { include: { role: true } },
      },
    });
  }
}
