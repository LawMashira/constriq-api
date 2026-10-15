import { CostCategory, Prisma } from '@prisma/client';
import { originalExpectedProfit, resolveExpectedCostLines } from './no-boq-baseline';

describe('no-BOQ expected cost baseline', () => {
  it('creates a project estimate from a total cost with no breakdown', () => {
    const plan = resolveExpectedCostLines({ expectedTotalCost: '80000.00' });
    expect(plan.incomplete).toBe(false);
    expect(plan.total.toFixed(2)).toBe('80000.00');
    expect(plan.lines).toEqual([
      expect.objectContaining({
        code: 'GEN',
        category: CostCategory.OTHER,
        amount: new Prisma.Decimal('80000.00'),
      }),
    ]);
  });

  it('uses an optional cost breakdown without requiring a BOQ', () => {
    const plan = resolveExpectedCostLines({
      expectedCosts: {
        materials: '30000.00',
        labour: '25000.00',
        transport: '5000.00',
        equipment: '10000.00',
        subcontractors: '8000.00',
        other: '2000.00',
      },
    });
    expect(plan.incomplete).toBe(false);
    expect(plan.total.toFixed(2)).toBe('80000.00');
    expect(plan.lines).toHaveLength(6);
  });

  it('rejects a total that does not match the breakdown', () => {
    expect(() =>
      resolveExpectedCostLines({
        expectedTotalCost: '100000.00',
        expectedCosts: { materials: '40000.00' },
      }),
    ).toThrow(/does not match/);
  });

  it('marks cost information incomplete instead of assuming zero', () => {
    const plan = resolveExpectedCostLines({});
    expect(plan.incomplete).toBe(true);
    expect(plan.lines).toHaveLength(0);
    expect(plan.total.toFixed(2)).toBe('0.00');
  });

  it('calculates original expected profit from the baseline values', () => {
    expect(originalExpectedProfit(new Prisma.Decimal('100000'), new Prisma.Decimal('80000')).toFixed(2)).toBe(
      '20000.00',
    );
  });
});
