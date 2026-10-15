import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  it('allows when no permissions are required', () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(httpContext({ permissions: [] }))).toBe(true);
  });

  it('allows when the user has every required permission', () => {
    const reflector = {
      getAllAndOverride: () => ['project.read', 'budget.approve'],
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(
      guard.canActivate(
        httpContext({
          permissions: ['project.read', 'budget.approve', 'cost.read'],
        }),
      ),
    ).toBe(true);
  });

  it('rejects missing permissions', () => {
    const reflector = {
      getAllAndOverride: () => ['budget.approve'],
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(() =>
      guard.canActivate(httpContext({ permissions: ['budget.read'] })),
    ).toThrow(ForbiddenException);
  });
});

function httpContext(user?: { permissions: string[] }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}
