import { Prisma } from '@prisma/client';
import { calculateProfit, variationQualifiesForRevenue } from './profit-formulas';

const d = (value: string) => new Prisma.Decimal(value);

describe('profit formulas', () => {
  const result = calculateProfit({
    originalContractValue: d('10000000'),
    qualifyingVariationRevenue: d('500000'),
    qualifyingVariationProfit: d('500000'),
    originalCostBudget: d('8000000'),
    currentCostBudget: d('8500000'),
    actualCost: d('4000000'),
    openCommittedCost: d('2000000'),
    forecastUncommittedCost: d('2800000'),
  });

  it('computes current approved revenue from original contract plus qualifying variations', () => {
    expect(result.originalContractValue.toFixed(2)).toBe('10000000.00');
    expect(result.expectedRevenue.toFixed(2)).toBe('10500000.00');
  });

  it('freezes original expected profit as original contract minus original budget', () => {
    expect(result.originalExpectedProfit.toFixed(2)).toBe('2000000.00');
    expect(result.expectedProfit.toFixed(2)).toBe('2000000.00');
  });

  it('does not use current budget or approved variations in original expected profit', () => {
    expect(result.currentBudget.toFixed(2)).toBe('8500000.00');
    expect(result.originalBudget.toFixed(2)).toBe('8000000.00');
  });

  it('computes forecast final cost without overlapping buckets', () => {
    expect(result.forecastFinalCost.toFixed(2)).toBe('8800000.00');
  });

  it('computes forecast profit from current approved revenue minus forecast final cost', () => {
    expect(result.forecastProfit.toFixed(2)).toBe('1700000.00');
    expect(result.currentPlannedProfit.toFixed(2)).toBe('2500000.00');
    expect(result.profitAtRisk.toFixed(2)).toBe('800000.00');
    expect(result.forecastMargin?.toFixed(4)).toBe('16.1905');
  });

  it('does not treat pending variations as approved contract revenue', () => {
    const pending = calculateProfit({
      originalContractValue: d('100000.00'),
      qualifyingVariationRevenue: d('0'),
      originalCostBudget: d('80000.00'),
      currentCostBudget: d('80000.00'),
      actualCost: d('0'),
      openCommittedCost: d('0'),
      forecastUncommittedCost: d('80000.00'),
    });
    expect(pending.expectedRevenue.toFixed(2)).toBe('100000.00');
    expect(pending.originalExpectedProfit.toFixed(2)).toBe('20000.00');
  });

  it('adds approved variations to current approved value and keeps the original contract', () => {
    const approved = calculateProfit({
      originalContractValue: d('100000.00'),
      qualifyingVariationRevenue: d('50000.00'),
      qualifyingVariationProfit: d('50000.00'),
      originalCostBudget: d('80000.00'),
      currentCostBudget: d('80000.00'),
      actualCost: d('10000.00'),
      openCommittedCost: d('20000.00'),
      forecastUncommittedCost: d('50000.00'),
    });
    expect(approved.originalContractValue.toFixed(2)).toBe('100000.00');
    expect(approved.expectedRevenue.toFixed(2)).toBe('150000.00');
    expect(approved.originalExpectedProfit.toFixed(2)).toBe('20000.00');
    expect(approved.forecastFinalCost.toFixed(2)).toBe('80000.00');
    expect(approved.forecastProfit.toFixed(2)).toBe('70000.00');
    expect(approved.profitAtRisk.toFixed(2)).toBe('0.00');
  });

  it('does not treat variation selling price as profit at risk', () => {
    const vo = calculateProfit({
      originalContractValue: d('100000.00'),
      qualifyingVariationRevenue: d('17000.00'),
      qualifyingVariationProfit: d('7000.00'),
      qualifyingVariationCost: d('10000.00'),
      originalCostBudget: d('80000.00'),
      currentCostBudget: d('90000.00'),
      actualCost: d('0'),
      openCommittedCost: d('0'),
      forecastUncommittedCost: d('90000.00'),
    });
    expect(vo.expectedRevenue.toFixed(2)).toBe('117000.00');
    expect(vo.originalExpectedProfit.toFixed(2)).toBe('20000.00');
    expect(vo.currentPlannedProfit.toFixed(2)).toBe('27000.00');
    expect(vo.forecastProfit.toFixed(2)).toBe('27000.00');
    expect(vo.profitAtRisk.toFixed(2)).toBe('0.00');
  });

  it('does not treat approved variation cost as profit at risk', () => {
    const vo = calculateProfit({
      originalContractValue: d('100000.00'),
      qualifyingVariationRevenue: d('17000.00'),
      qualifyingVariationCost: d('10000.00'),
      originalCostBudget: d('80000.00'),
      currentCostBudget: d('80000.00'),
      actualCost: d('0'),
      openCommittedCost: d('0'),
      forecastUncommittedCost: d('90000.00'),
    });
    expect(vo.profitAtRisk.toFixed(2)).toBe('0.00');
    expect(vo.forecastFinalCost.toFixed(2)).toBe('90000.00');
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

  it('keeps original contract unchanged when a variation is only pending', () => {
    const pending = calculateProfit({
      originalContractValue: d('100000'),
      qualifyingVariationRevenue: d('0'),
      originalCostBudget: d('80000'),
      currentCostBudget: d('80000'),
      actualCost: d('10000'),
      openCommittedCost: d('5000'),
      forecastUncommittedCost: d('65000'),
    });
    expect(pending.expectedRevenue.toFixed(2)).toBe('100000.00');
    expect(pending.expectedProfit.toFixed(2)).toBe('20000.00');
  });

  it('adds approved variation revenue to current approved value only', () => {
    const approved = calculateProfit({
      originalContractValue: d('100000'),
      qualifyingVariationRevenue: d('50000'),
      qualifyingVariationProfit: d('50000'),
      originalCostBudget: d('80000'),
      currentCostBudget: d('80000'),
      actualCost: d('10000'),
      openCommittedCost: d('5000'),
      forecastUncommittedCost: d('65000'),
    });
    expect(approved.originalContractValue.toFixed(2)).toBe('100000.00');
    expect(approved.expectedRevenue.toFixed(2)).toBe('150000.00');
    expect(approved.expectedProfit.toFixed(2)).toBe('20000.00');
    expect(approved.forecastProfit.toFixed(2)).toBe('70000.00');
    expect(approved.originalBudget.toFixed(2)).toBe('80000.00');
  });

  it('does not double-count actuals, commitments, and forecast-to-complete', () => {
    expect(result.forecastFinalCost.toFixed(2)).toBe('8800000.00');
    expect(result.actualCost.plus(result.openCommittedCost).plus(result.forecastUncommittedCost).toFixed(2)).toBe(
      result.forecastFinalCost.toFixed(2),
    );
  });

  it('does not treat withdrawn or rejected variations as revenue', () => {
    expect(variationQualifiesForRevenue('REJECTED', 'APPROVED')).toBe(false);
    expect(variationQualifiesForRevenue('CANCELLED', 'APPROVED')).toBe(false);
    expect(variationQualifiesForRevenue('WITHDRAWN', 'APPROVED')).toBe(false);
  });
});
