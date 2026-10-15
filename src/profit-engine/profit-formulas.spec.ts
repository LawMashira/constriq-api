import { Prisma } from '@prisma/client';
import { calculateProfit, variationQualifiesForRevenue } from './profit-formulas';

const d = (value: string) => new Prisma.Decimal(value);

describe('profit formulas', () => {
  const result = calculateProfit({
    originalContractValue: d('10000000'),
    qualifyingVariationRevenue: d('500000'),
    originalCostBudget: d('8000000'),
    currentCostBudget: d('8500000'),
    actualCost: d('4000000'),
    openCommittedCost: d('2000000'),
    forecastUncommittedCost: d('2800000'),
  });

  it('computes expected revenue from original contract plus qualifying variations', () => {
    expect(result.expectedRevenue.toFixed(2)).toBe('10500000.00');
  });

  it('computes expected profit from expected revenue minus original budget', () => {
    expect(result.expectedProfit.toFixed(2)).toBe('2500000.00');
  });

  it('does not use current budget in expected profit', () => {
    expect(result.currentBudget.toFixed(2)).toBe('8500000.00');
    expect(result.originalBudget.toFixed(2)).toBe('8000000.00');
  });

  it('computes forecast final cost without overlapping buckets', () => {
    expect(result.forecastFinalCost.toFixed(2)).toBe('8800000.00');
  });

  it('computes forecast profit, profit at risk, and margin', () => {
    expect(result.forecastProfit.toFixed(2)).toBe('1700000.00');
    expect(result.profitAtRisk.toFixed(2)).toBe('800000.00');
    expect(result.forecastMargin?.toFixed(4)).toBe('16.1905');
  });

  it('returns null margin when expected revenue is zero', () => {
    const empty = calculateProfit({
      originalContractValue: d('0'),
      qualifyingVariationRevenue: d('0'),
      originalCostBudget: d('0'),
      currentCostBudget: d('0'),
      actualCost: d('0'),
      openCommittedCost: d('0'),
      forecastUncommittedCost: d('0'),
    });
    expect(empty.forecastMargin).toBeNull();
  });

  it('never treats submitted variations as revenue', () => {
    expect(variationQualifiesForRevenue('SUBMITTED', 'APPROVED')).toBe(false);
    expect(variationQualifiesForRevenue('APPROVED', 'APPROVED')).toBe(true);
    expect(variationQualifiesForRevenue('APPROVED', 'EXECUTED')).toBe(false);
    expect(variationQualifiesForRevenue('EXECUTED', 'EXECUTED')).toBe(true);
  });
});
