import { Prisma } from '@prisma/client';
import { matchingApprovalRule } from './approval-match';

describe('matchingApprovalRule', () => {
  it('selects the band that contains the amount', () => {
    const rules = [
      { minAmount: new Prisma.Decimal('0'), maxAmount: new Prisma.Decimal('10000'), active: true, id: 'low' },
      { minAmount: new Prisma.Decimal('10000.01'), maxAmount: null, active: true, id: 'high' },
    ];
    expect(matchingApprovalRule(rules, new Prisma.Decimal('5000'))?.id).toBe('low');
    expect(matchingApprovalRule(rules, new Prisma.Decimal('25000'))?.id).toBe('high');
  });

  it('ignores inactive rules', () => {
    const rules = [
      { minAmount: new Prisma.Decimal('0'), maxAmount: null, active: false, id: 'off' },
    ];
    expect(matchingApprovalRule(rules, new Prisma.Decimal('1'))).toBeUndefined();
  });
});
