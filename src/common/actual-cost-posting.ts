import {
  FinancialPostingType,
  FinancialSourceType,
  ForecastStatus,
  Prisma,
} from '@prisma/client';
import { money, zero } from './money';

export async function consumeUncommittedForecast(
  tx: Prisma.TransactionClient,
  input: { companyId: string; projectId: string; costCodeId?: string | null; amount: Prisma.Decimal },
) {
  if (!input.costCodeId) {
    return;
  }
  const needed = money(input.amount);
  if (needed.lte(0)) {
    return;
  }
  const forecast = await tx.costForecast.findFirst({
    where: {
      companyId: input.companyId,
      projectId: input.projectId,
      costCodeId: input.costCodeId,
      status: ForecastStatus.ACTIVE,
    },
    orderBy: { forecastDate: 'desc' },
  });
  if (!forecast) {
    return;
  }
  const remaining = money(forecast.amount).minus(needed);
  const nextAmount = remaining.lt(0) ? zero() : remaining;
  await tx.costForecast.update({
    where: { id: forecast.id },
    data: { amount: nextAmount },
  });
  if (forecast.financialPostingId) {
    await tx.financialPosting.update({
      where: { id: forecast.financialPostingId },
      data: { amount: nextAmount },
    });
  }
}

export async function postActualCost(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    projectId: string;
    costCodeId?: string | null;
    createdById?: string;
    description: string;
    amount: Prisma.Decimal;
    transactionDate: Date;
    sourceType: FinancialSourceType;
    sourceId: string;
    labourRecordId?: string;
    plantRecordId?: string;
    subcontractClaimId?: string;
    invoiceId?: string;
    commitmentId?: string;
    supplierId?: string;
    reference?: string;
    consumeForecast?: boolean;
  },
) {
  const posting = await tx.financialPosting.create({
    data: {
      companyId: input.companyId,
      projectId: input.projectId,
      costCodeId: input.costCodeId ?? undefined,
      postingType: FinancialPostingType.ACTUAL,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      amount: money(input.amount),
      postingDate: input.transactionDate,
    },
  });
  const cost = await tx.actualCost.create({
    data: {
      companyId: input.companyId,
      projectId: input.projectId,
      costCodeId: input.costCodeId ?? undefined,
      createdById: input.createdById,
      description: input.description,
      amount: money(input.amount),
      transactionDate: input.transactionDate,
      reference: input.reference,
      supplierId: input.supplierId,
      invoiceId: input.invoiceId,
      commitmentId: input.commitmentId,
      labourRecordId: input.labourRecordId,
      plantRecordId: input.plantRecordId,
      subcontractClaimId: input.subcontractClaimId,
      isUnallocated: !input.costCodeId,
      isPosted: true,
      postedAt: new Date(),
      financialPostingId: posting.id,
    },
  });
  if (input.consumeForecast !== false) {
    await consumeUncommittedForecast(tx, {
      companyId: input.companyId,
      projectId: input.projectId,
      costCodeId: input.costCodeId,
      amount: money(input.amount),
    });
  }
  return { posting, cost };
}
