import {
  AuditAction,
  MembershipStatus,
  Prisma,
  PrismaClient,
  SystemRole,
  UserStatus,
} from '@prisma/client';
import { PERMISSION_CATALOG, SYSTEM_ROLE_PRESETS } from './permission-catalog';

type IdentityDb = Pick<
  Prisma.TransactionClient,
  'permission' | 'roleDefinition' | 'rolePermission' | 'userRole' | 'companyMembership'
>;

export async function ensureGlobalPermissions(db: IdentityDb) {
  const existing = await db.permission.findMany({
    where: { code: { in: PERMISSION_CATALOG.map((item) => item.code) } },
    select: { code: true, description: true, module: true },
  });
  const byCode = new Map(existing.map((item) => [item.code, item]));
  const toCreate = PERMISSION_CATALOG.filter((item) => !byCode.has(item.code));
  if (toCreate.length) {
    await db.permission.createMany({ data: toCreate });
  }

  const toUpdate = PERMISSION_CATALOG.filter((item) => {
    const row = byCode.get(item.code);
    return Boolean(row && (row.description !== item.description || row.module !== item.module));
  });
  if (toUpdate.length) {
    await Promise.all(
      toUpdate.map((item) =>
        db.permission.update({
          where: { code: item.code },
          data: { description: item.description, module: item.module },
        }),
      ),
    );
  }
}

async function grantPresetRolePermissions(
  db: IdentityDb,
  companyId: string,
  permissionByCode: Map<string, string>,
) {
  const roles = await db.roleDefinition.findMany({
    where: {
      companyId,
      name: { in: SYSTEM_ROLE_PRESETS.map((preset) => preset.name) },
    },
    select: { id: true, name: true },
  });
  const roleByName = new Map(roles.map((role) => [role.name, role.id]));
  const links: { roleId: string; permissionId: string }[] = [];

  for (const preset of SYSTEM_ROLE_PRESETS) {
    const roleId = roleByName.get(preset.name);
    if (!roleId) {
      continue;
    }
    const codes =
      preset.permissionCodes === 'ALL'
        ? PERMISSION_CATALOG.map((item) => item.code)
        : preset.permissionCodes;
    for (const code of codes) {
      const permissionId = permissionByCode.get(code);
      if (permissionId) {
        links.push({ roleId, permissionId });
      }
    }
  }

  if (links.length) {
    await db.rolePermission.createMany({ data: links, skipDuplicates: true });
  }
}

export async function bootstrapCompanyIdentity(
  db: IdentityDb,
  input: {
    companyId: string;
    userId: string;
    ownerUserStatus: UserStatus;
  },
  options?: { skipGlobalPermissions?: boolean },
) {
  if (!options?.skipGlobalPermissions) {
    await ensureGlobalPermissions(db);
  }

  const permissions = await db.permission.findMany({
    where: { code: { in: PERMISSION_CATALOG.map((item) => item.code) } },
  });
  const permissionByCode = new Map(permissions.map((item) => [item.code, item.id]));

  await db.roleDefinition.createMany({
    data: SYSTEM_ROLE_PRESETS.map((preset) => ({
      companyId: input.companyId,
      name: preset.name,
      systemRole: preset.systemRole,
      isSystem: true,
      isReadOnly: preset.isReadOnly,
    })),
    skipDuplicates: true,
  });

  const roles = await db.roleDefinition.findMany({
    where: {
      companyId: input.companyId,
      name: { in: SYSTEM_ROLE_PRESETS.map((preset) => preset.name) },
    },
    select: { id: true, name: true },
  });
  const roleByName = new Map(roles.map((role) => [role.name, role.id]));
  const roleIds = new Map<SystemRole, string>();
  for (const preset of SYSTEM_ROLE_PRESETS) {
    const roleId = roleByName.get(preset.name);
    if (roleId) {
      roleIds.set(preset.systemRole, roleId);
    }
  }

  await grantPresetRolePermissions(db, input.companyId, permissionByCode);

  const ownerRoleId = roleIds.get(SystemRole.OWNER);
  if (!ownerRoleId) {
    throw new Error('Owner role was not created');
  }

  await db.userRole.upsert({
    where: {
      userId_roleId: { userId: input.userId, roleId: ownerRoleId },
    },
    create: { userId: input.userId, roleId: ownerRoleId },
    update: {},
  });

  const membershipStatus =
    input.ownerUserStatus === UserStatus.ACTIVE
      ? MembershipStatus.ACTIVE
      : MembershipStatus.INVITED;

  await db.companyMembership.upsert({
    where: {
      companyId_userId: { companyId: input.companyId, userId: input.userId },
    },
    create: {
      companyId: input.companyId,
      userId: input.userId,
      status: membershipStatus,
    },
    update: { status: membershipStatus },
  });
}

export async function syncCompanyRolePermissions(db: IdentityDb, companyId: string) {
  await ensureGlobalPermissions(db);
  const permissions = await db.permission.findMany({
    where: { code: { in: PERMISSION_CATALOG.map((item) => item.code) } },
  });
  const permissionByCode = new Map(permissions.map((item) => [item.code, item.id]));
  await grantPresetRolePermissions(db, companyId, permissionByCode);
}

export async function syncIdentityCatalog(prisma: PrismaClient) {
  await ensureGlobalPermissions(prisma);
  const permissions = await prisma.permission.findMany({
    where: { code: { in: PERMISSION_CATALOG.map((item) => item.code) } },
  });
  const permissionByCode = new Map(permissions.map((item) => [item.code, item.id]));
  const companies = await prisma.company.findMany({ select: { id: true } });
  for (const company of companies) {
    await grantPresetRolePermissions(prisma, company.id, permissionByCode);
  }
}

export async function activateCompanyMembership(
  db: IdentityDb,
  input: { companyId: string; userId: string },
) {
  await db.companyMembership.updateMany({
    where: { companyId: input.companyId, userId: input.userId },
    data: { status: MembershipStatus.ACTIVE },
  });
}

export function companyRegisteredAudit(input: {
  companyId: string;
  userId: string;
}) {
  return {
    userId: input.userId,
    action: AuditAction.CREATE,
    module: 'AUTH' as const,
    entityType: 'COMPANY' as const,
    entityId: input.companyId,
    description: 'Company registered',
    source: 'USER' as const,
  };
}
