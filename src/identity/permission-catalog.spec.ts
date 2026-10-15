import { PermissionModule, SystemRole } from '@prisma/client';
import { PERMISSION_CATALOG, SYSTEM_ROLE_PRESETS } from './permission-catalog';

describe('permission catalog', () => {
  it('has unique permission codes', () => {
    const codes = PERMISSION_CATALOG.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('covers the product permission examples', () => {
    const codes = new Set(PERMISSION_CATALOG.map((item) => item.code));
    for (const required of [
      'project.read',
      'project.create',
      'project.update',
      'project.delete',
      'budget.read',
      'budget.create',
      'budget.update',
      'budget.approve',
      'cost.read',
      'cost.create',
      'cost.update',
      'cost.approve',
      'procurement.read',
      'procurement.request',
      'procurement.create',
      'procurement.approve',
      'variation.read',
      'variation.create',
      'variation.submit',
      'variation.approve',
      'claim.read',
      'claim.create',
      'claim.submit',
      'claim.certify',
      'payment.read',
      'payment.create',
      'payment.approve',
      'financial_dashboard.read',
      'reports.read',
      'company.settings',
      'users.manage',
    ]) {
      expect(codes.has(required)).toBe(true);
    }
  });

  it('assigns a valid module to every permission', () => {
    const modules = new Set(Object.values(PermissionModule));
    for (const permission of PERMISSION_CATALOG) {
      expect(modules.has(permission.module)).toBe(true);
    }
  });

  it('defines every system role including EXECUTIVE_READ_ONLY', () => {
    const roles = new Set(SYSTEM_ROLE_PRESETS.map((item) => item.systemRole));
    expect(roles.has(SystemRole.OWNER)).toBe(true);
    expect(roles.has(SystemRole.EXECUTIVE_READ_ONLY)).toBe(true);
    expect(roles.size).toBe(Object.keys(SystemRole).length);
  });

  it('does not grant write permissions to executive read-only', () => {
    const preset = SYSTEM_ROLE_PRESETS.find(
      (item) => item.systemRole === SystemRole.EXECUTIVE_READ_ONLY,
    );
    expect(preset?.permissionCodes).not.toBe('ALL');
    if (preset && preset.permissionCodes !== 'ALL') {
      expect(preset.permissionCodes.every((code) => code.endsWith('.read'))).toBe(
        true,
      );
    }
  });

  it('gives site managers site operations without commercial approval', () => {
    const preset = SYSTEM_ROLE_PRESETS.find(
      (item) => item.systemRole === SystemRole.SITE_MANAGER,
    );
    expect(preset?.permissionCodes).not.toBe('ALL');
    if (preset && preset.permissionCodes !== 'ALL') {
      for (const required of [
        'project.read',
        'contract.read',
        'cost_code.read',
        'cost.read',
        'cost.create',
        'labour.read',
        'labour.create',
        'subcontractor.read',
        'variation.read',
        'variation.create',
        'variation.submit',
        'claim.read',
        'claim.create',
        'document.read',
        'document.create',
        'procurement.read',
        'procurement.request',
      ]) {
        expect(preset.permissionCodes).toContain(required);
      }
      expect(preset.permissionCodes).not.toContain('procurement.create');
      expect(preset.permissionCodes).not.toContain('procurement.approve');
      expect(preset.permissionCodes).not.toContain('variation.approve');
      expect(preset.permissionCodes).not.toContain('financial_dashboard.read');
      expect(preset.permissionCodes).not.toContain('company.settings');
    }
  });
});
