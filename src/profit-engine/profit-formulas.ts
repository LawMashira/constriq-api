import { Prisma } from '@prisma/client';
import { money, percentRatio, subtract, zero } from '../common/money';

export type ProfitInputs = {
  originalContractValue: Prisma.Decimal;
  qualifyingVariationRevenue: Prisma.Decimal;
  qualifyingVariationProfit?: Prisma.Decimal;
  qualifyingVariationCost?: Prisma.Decimal;
  originalCostBudget: Prisma.Decimal;
  currentCostBudget: Prisma.Decimal;
  actualCost: Prisma.Decimal;
  openCommittedCost: Prisma.Decimal;
  forecastUncommittedCost: Prisma.Decimal;
  certifiedRevenue?: Prisma.Decimal;
  cashReceived?: Prisma.Decimal;
};

export type ProfitResult = {
  originalContractValue: Prisma.Decimal;
  expectedRevenue: Prisma.Decimal;
  originalExpectedProfit: Prisma.Decimal;
  currentPlannedProfit: Prisma.Decimal;
  expectedProfit: Prisma.Decimal;
  forecastFinalCost: Prisma.Decimal;
  forecastProfit: Prisma.Decimal;
  profitAtRisk: Prisma.Decimal;
  forecastMargin: Prisma.Decimal | null;
  originalBudget: Prisma.Decimal;
  currentBudget: Prisma.Decimal;
  actualCost: Prisma.Decimal;
  openCommittedCost: Prisma.Decimal;
  forecastUncommittedCost: Prisma.Decimal;
  certifiedRevenue: Prisma.Decimal;
  cashReceived: Prisma.Decimal;
};

export function calculateProfit(input: ProfitInputs): ProfitResult {
  const originalContractValue = money(input.originalContractValue);
  const expectedRevenue = originalContractValue.plus(money(input.qualifyingVariationRevenue));
  const originalBudget = money(input.originalCostBudget);
  const originalExpectedProfit = subtract(originalContractValue, originalBudget);
  const variationCost = money(input.qualifyingVariationCost ?? zero());
  const variationProfit = money(
    input.qualifyingVariationProfit ?? money(input.qualifyingVariationRevenue).minus(variationCost),
  );
  const currentPlannedProfit = originalExpectedProfit.plus(variationProfit);
  const actualCost = money(input.actualCost);
  const openCommittedCost = money(input.openCommittedCost);
  const forecastUncommittedCost = money(input.forecastUncommittedCost);
  const forecastFinalCost = actualCost.plus(openCommittedCost).plus(forecastUncommittedCost);
  const forecastProfit = subtract(expectedRevenue, forecastFinalCost);
  const allowedFinalCost = originalBudget.plus(variationCost);
  const rawAtRisk = subtract(forecastFinalCost, allowedFinalCost);
  const profitAtRisk = rawAtRisk.gt(0) ? rawAtRisk : zero();

  return {
    originalContractValue,
    expectedRevenue,
    originalExpectedProfit,
    currentPlannedProfit,
    expectedProfit: originalExpectedProfit,
    forecastFinalCost,
    forecastProfit,
    profitAtRisk,
    forecastMargin: percentRatio(forecastProfit, expectedRevenue),
    originalBudget,
    currentBudget: money(input.currentCostBudget),
    actualCost,
    openCommittedCost,
    forecastUncommittedCost,
    certifiedRevenue: money(input.certifiedRevenue ?? zero()),
    cashReceived: money(input.cashReceived ?? zero()),
  };
}

export function variationQualifiesForRevenue(
  status: string,
  rule: 'APPROVED' | 'EXECUTED',
): boolean {
  if (
    status === 'SUBMITTED' ||
    status === 'DRAFT' ||
    status === 'REJECTED' ||
    status === 'CANCELLED' ||
    status === 'WITHDRAWN'
  ) {
    return false;
  }
  if (rule === 'APPROVED') {
    return status === 'APPROVED' || status === 'EXECUTED';
  }
  return status === 'EXECUTED';
}

/** Approved VO cost belongs in remaining forecast unless a posting already carries it. */
export function uncommittedForecastWithVariationCosts(input: {
  forecastFromPostings: Prisma.Decimal;
  qualifyingVariationCost: Prisma.Decimal;
  postedVariationForecast?: Prisma.Decimal;
}): Prisma.Decimal {
  const posted = money(input.postedVariationForecast ?? zero());
  const missing = money(input.qualifyingVariationCost).minus(posted);
  return money(input.forecastFromPostings).plus(missing.gt(0) ? missing : zero());
}
