import { MembershipStatus, SystemRole, UserStatus } from '@prisma/client';
import { PERMISSION_CATALOG } from './permission-catalog';
import { bootstrapCompanyIdentity } from './tenant-bootstrap';

function createTx() {
  const permissions = new Map<
    string,
    { id: string; code: string; description?: string; module?: string }
  >();
  const roles = new Map<string, { id: string; name: string; systemRole: SystemRole; companyId: string }>();
  const rolePermissions: Array<{ roleId: string; permissionId: string }> = [];
  const userRoles: Array<{ userId: string; roleId: string }> = [];
  const memberships: Array<{
    companyId: string;
    userId: string;
    status: MembershipStatus;
  }> = [];

  const tx = {
    permission: {
      findMany: jest.fn(async () => [...permissions.values()]),
      createMany: jest.fn(async ({ data }: { data: Array<{ code: string; description: string; module: string }> }) => {
        for (const create of data) {
          permissions.set(create.code, {
            id: `perm-${create.code}`,
            code: create.code,
            description: create.description,
            module: create.module,
          });
        }
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: { where: { code: string }; data: { description: string; module: string } }) => {
        const existing = permissions.get(where.code);
        if (existing) {
          Object.assign(existing, data);
        }
        return existing;
      }),
    },
    roleDefinition: {
      createMany: jest.fn(
        async ({
          data,
        }: {
          data: Array<{
            companyId: string;
            name: string;
            systemRole: SystemRole;
            isSystem: boolean;
            isReadOnly: boolean;
          }>;
        }) => {
          for (const create of data) {
            const key = `${create.companyId}:${create.name}`;
            if (!roles.has(key)) {
              roles.set(key, {
                id: `role-${create.systemRole}`,
                name: create.name,
                systemRole: create.systemRole,
                companyId: create.companyId,
              });
            }
          }
          return { count: data.length };
        },
      ),
      upsert: jest.fn(async ({ where, create }) => {
        const key = `${where.companyId_name.companyId}:${where.companyId_name.name}`;
        const existing = roles.get(key);
        if (existing) {
          return existing;
        }
        const created = {
          id: `role-${create.systemRole}`,
          name: create.name,
          systemRole: create.systemRole,
          companyId: create.companyId,
        };
        roles.set(key, created);
        return created;
      }),
      findMany: jest.fn(async ({ where }: { where: { companyId: string; name?: { in: string[] } } }) => {
        return [...roles.values()].filter(
          (role) =>
            role.companyId === where.companyId &&
            (!where.name?.in || where.name.in.includes(role.name)),
        );
      }),
    },
    rolePermission: {
      createMany: jest.fn(async ({ data }: { data: Array<{ roleId: string; permissionId: string }> }) => {
        rolePermissions.push(...data);
        return { count: data.length };
      }),
    },
    userRole: {
      upsert: jest.fn(async ({ create }) => {
        userRoles.push(create);
        return create;
      }),
    },
    companyMembership: {
      upsert: jest.fn(async ({ create }) => {
        memberships.push(create);
        return create;
      }),
    },
  };

  return { tx, permissions, roles, rolePermissions, userRoles, memberships };
}

describe('bootstrapCompanyIdentity', () => {
  it('creates membership, owner role, and grants owner all permissions', async () => {
    const { tx, rolePermissions, userRoles, memberships } = createTx();

    await bootstrapCompanyIdentity(tx as never, {
      companyId: 'co_1',
      userId: 'user_1',
      ownerUserStatus: UserStatus.INVITED,
    });

    expect(memberships).toEqual([
      {
        companyId: 'co_1',
        userId: 'user_1',
        status: MembershipStatus.INVITED,
      },
    ]);
    expect(userRoles).toEqual([
      { userId: 'user_1', roleId: `role-${SystemRole.OWNER}` },
    ]);
    const ownerPermissionCount = rolePermissions.filter(
      (item) => item.roleId === `role-${SystemRole.OWNER}`,
    ).length;
    expect(ownerPermissionCount).toBe(PERMISSION_CATALOG.length);
  });
});
