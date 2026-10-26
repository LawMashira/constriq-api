import {
  BudgetRevisionStatus,
  CostCategory,
  FinancialPostingType,
  FinancialSourceType,
  ForecastStatus,
  ImportType,
  Prisma,
  RevenuePostingType,
  VariationStatus,
} from '@prisma/client';
import { money, rate } from '../common/money';
import { MappedRow } from './mapping';

export type ApplyContext = {
  companyId: string;
  projectId: string;
  userId: string;
  importId: string;
  createMissingCostCodes?: boolean;
  createMissingSuppliers?: boolean;
};

export async function applyImportRows(
  tx: Prisma.TransactionClient,
  type: ImportType,
  rows: MappedRow[],
  context: ApplyContext,
): Promise<{ created: number }> {
  switch (type) {
    case ImportType.BOQ:
      return applyBoq(tx, rows, context);
    case ImportType.BUDGET:
      return applyBudget(tx, rows, context);
    case ImportType.COST:
      return applyCosts(tx, rows, context);
    case ImportType.FORECAST:
      return applyForecasts(tx, rows, context);
    case ImportType.VARIATION:
      return applyVariations(tx, rows, context);
    case ImportType.CLAIM:
      return applyClaims(tx, rows, context);
    case ImportType.COMMITMENT:
      return applyCommitments(tx, rows, context);
    default:
      throw new Error(`Unsupported import type ${type}`);
  }
}

async function applyBoq(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  const latest = await tx.boq.findFirst({
    where: { projectId: context.projectId },
    orderBy: { version: 'desc' },
  });
  const items: Prisma.BoqItemUncheckedCreateWithoutBoqInput[] = [];
  const costAmounts: Prisma.Decimal[] = [];
  for (const row of rows) {
    const costCodeId = await resolveCostCode(tx, context, row.values.costCode, row.values.costCodeName, row.values.category);
    const quantity = rate(cleanNumber(row.values.quantity));
    const unitRate = rate(cleanNumber(row.values.rate));
    const amount = row.values.amount
      ? money(cleanNumber(row.values.amount))
      : money(quantity.times(unitRate));
    const costAmount = row.values.costRate
      ? money(quantity.times(rate(cleanNumber(row.values.costRate))))
      : amount;
    items.push({
      itemCode: row.values.itemCode || row.values.costCode || `R${row.rowNumber}`,
      description: withExtras(row.values.description, row.extras),
      section: emptyToUndefined(row.values.section),
      category: parseCategory(row.values.category),
      costCodeId,
      quantity,
      unit: emptyToUndefined(row.values.unit),
      rate: unitRate,
      amount,
    });
    costAmounts.push(costAmount);
  }
  const created = await tx.boq.create({
    data: {
      projectId: context.projectId,
      name: `Import ${context.importId.slice(0, 8)}`,
      version: (latest?.version ?? 0) + 1,
      importId: context.importId,
      items: { create: items },
    },
    include: { items: true },
  });
  await seedCommercialFromBoq(
    tx,
    context,
    created.items.map((item, index) => ({ ...item, costAmount: costAmounts[index] ?? item.amount })),
  );
  await tx.project.update({
    where: { id: context.projectId },
    data: { usesBoq: true },
  });
  return { created: items.length };
}

export async function seedCommercialFromBoq(
  tx: Prisma.TransactionClient,
  context: ApplyContext,
  items: Array<{ id: string; costCodeId: string | null; amount: Prisma.Decimal; costAmount?: Prisma.Decimal }>,
) {
  if (!items.length) {
    return { seeded: false };
  }
  const fallbackId = await ensureSystemCostCode(tx, context);
  const billedByCode = new Map<string, Prisma.Decimal>();
  const costByCode = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    const costCodeId = item.costCodeId ?? fallbackId;
    if (!item.costCodeId) {
      await tx.boqItem.update({ where: { id: item.id }, data: { costCodeId } });
    }
    const billed = money(item.amount);
    const cost = money(item.costAmount ?? item.amount);
    billedByCode.set(costCodeId, money(billedByCode.get(costCodeId) ?? 0).plus(billed));
    costByCode.set(costCodeId, money(costByCode.get(costCodeId) ?? 0).plus(cost));
  }
  const contractTotal = [...billedByCode.values()].reduce((sum, amount) => sum.plus(amount), money(0));
  const budgetTotal = [...costByCode.values()].reduce((sum, amount) => sum.plus(amount), money(0));
  if (contractTotal.lte(0) && budgetTotal.lte(0)) {
    return { seeded: false };
  }

  const existingContract = await tx.contract.findFirst({
    where: { projectId: context.projectId, companyId: context.companyId },
  });
  if (!existingContract && contractTotal.gt(0)) {
    const contract = await tx.contract.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        contractNo: 'BOQ-1',
        title: 'Priced bill of quantities',
        originalValue: contractTotal,
        revisedValue: contractTotal,
      },
    });
    await tx.revenuePosting.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        contractId: contract.id,
        postingType: RevenuePostingType.CONTRACT_BASE,
        amount: contractTotal,
        postingDate: new Date(),
      },
    });
  }

  const existingBudget = await tx.projectBudget.findUnique({ where: { projectId: context.projectId } });
  if (!existingBudget && budgetTotal.gt(0)) {
    await tx.projectBudget.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        originalAmount: budgetTotal,
        currentAmount: budgetTotal,
        approvedAt: new Date(),
        lines: {
          create: [...costByCode.entries()].map(([costCodeId, amount]) => ({
            costCodeId,
            originalAmount: amount,
            currentAmount: amount,
          })),
        },
      },
    });
  }

  const existingForecast = await tx.costForecast.findFirst({
    where: { projectId: context.projectId, companyId: context.companyId },
  });
  if (!existingForecast) {
    for (const [costCodeId, amount] of costByCode) {
      if (amount.lte(0)) {
        continue;
      }
      const forecast = await tx.costForecast.create({
        data: {
          companyId: context.companyId,
          projectId: context.projectId,
          costCodeId,
          amount,
          reason: 'Remaining cost assumed equal to the imported cost rates until a forecast is posted',
          period: new Date(),
          forecastDate: new Date(),
          status: ForecastStatus.ACTIVE,
          createdById: context.userId,
        },
      });
      const posting = await tx.financialPosting.create({
        data: {
          companyId: context.companyId,
          projectId: context.projectId,
          costCodeId,
          postingType: FinancialPostingType.FORECAST,
          sourceType: FinancialSourceType.FORECAST,
          sourceId: forecast.id,
          amount,
          postingDate: new Date(),
        },
      });
      await tx.costForecast.update({
        where: { id: forecast.id },
        data: { financialPostingId: posting.id },
      });
    }
  }

  return { seeded: true };
}

async function ensureSystemCostCode(tx: Prisma.TransactionClient, context: ApplyContext) {
  const existing = await tx.costCode.findFirst({
    where: { projectId: context.projectId, code: { equals: 'BOQ', mode: 'insensitive' } },
  });
  if (existing) {
    return existing.id;
  }
  try {
    const created = await tx.costCode.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        code: 'BOQ',
        name: 'Bill of quantities',
        category: CostCategory.OTHER,
      },
    });
    return created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const retry = await tx.costCode.findFirst({
        where: { projectId: context.projectId, code: { equals: 'BOQ', mode: 'insensitive' } },
      });
      if (retry) {
        return retry.id;
      }
    }
    throw error;
  }
}

async function applyBudget(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  const existing = await tx.projectBudget.findUnique({
    where: { projectId: context.projectId },
    include: { lines: true },
  });
  const lines: Array<{
    costCodeId: string;
    amount: Prisma.Decimal;
    originalAmount: Prisma.Decimal;
  }> = [];
  for (const row of rows) {
    const costCodeId = await resolveCostCode(
      tx,
      context,
      row.values.costCode,
      row.values.costCodeName,
      row.values.category,
      true,
    );
    lines.push({
      costCodeId: costCodeId!,
      amount: money(cleanNumber(row.values.amount)),
      originalAmount: row.values.originalAmount
        ? money(cleanNumber(row.values.originalAmount))
        : money(cleanNumber(row.values.amount)),
    });
  }
  const total = lines.reduce((sum, line) => sum.plus(line.amount), money(0));
  if (!existing) {
    await tx.projectBudget.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        originalAmount: total,
        currentAmount: total,
        approvedAt: new Date(),
        lines: {
          create: lines.map((line) => ({
            costCodeId: line.costCodeId,
            originalAmount: line.originalAmount,
            currentAmount: line.amount,
          })),
        },
      },
    });
    return { created: lines.length };
  }

  await tx.budgetRevision.create({
    data: {
      companyId: context.companyId,
      projectId: context.projectId,
      budgetId: existing.id,
      previousAmount: existing.currentAmount,
      newAmount: total,
      difference: money(total).minus(existing.currentAmount),
      reason: `Excel import ${context.importId}`,
      status: BudgetRevisionStatus.APPROVED,
      submittedById: context.userId,
      approvedById: context.userId,
      approvedAt: new Date(),
      lines: {
        create: lines.map((line) => {
          const previous = existing.lines.find((item) => item.costCodeId === line.costCodeId);
          return {
            costCodeId: line.costCodeId,
            originalAmount: previous?.originalAmount ?? line.originalAmount,
            previousCurrentAmount: previous?.currentAmount ?? money(0),
            newCurrentAmount: line.amount,
            difference: money(line.amount).minus(previous?.currentAmount ?? 0),
          };
        }),
      },
    },
  });
  await tx.projectBudget.update({
    where: { id: existing.id },
    data: { currentAmount: total },
  });
  for (const line of lines) {
    const previous = existing.lines.find((item) => item.costCodeId === line.costCodeId);
    if (previous) {
      await tx.projectBudgetLine.update({
        where: { id: previous.id },
        data: { currentAmount: line.amount },
      });
    } else {
      await tx.projectBudgetLine.create({
        data: {
          budgetId: existing.id,
          costCodeId: line.costCodeId,
          originalAmount: money(0),
          currentAmount: line.amount,
        },
      });
    }
  }
  return { created: lines.length };
}

async function applyCosts(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  let created = 0;
  for (const row of rows) {
    const costCodeId = await resolveCostCode(tx, context, row.values.costCode, undefined, undefined);
    const supplierId = await resolveSupplier(tx, context, row.values.supplierName);
    const amount = money(cleanNumber(row.values.amount));
    const date = parseDate(row.values.transactionDate);
    const cost = await tx.actualCost.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        costCodeId,
        supplierId,
        createdById: context.userId,
        description: withExtras(row.values.description, row.extras),
        amount,
        taxAmount: row.values.taxAmount ? money(cleanNumber(row.values.taxAmount)) : money(0),
        transactionDate: date,
        reference: emptyToUndefined(row.values.reference),
        payeeName: emptyToUndefined(row.values.payeeName),
        isUnallocated: !costCodeId,
        isPosted: true,
        postedAt: new Date(),
      },
    });
    const posting = await tx.financialPosting.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        costCodeId,
        postingType: FinancialPostingType.ACTUAL,
        sourceType: FinancialSourceType.MANUAL_COST,
        sourceId: cost.id,
        amount,
        postingDate: date,
      },
    });
    await tx.actualCost.update({
      where: { id: cost.id },
      data: { financialPostingId: posting.id },
    });
    created += 1;
  }
  return { created };
}

async function applyForecasts(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  let created = 0;
  for (const row of rows) {
    const costCodeId = await resolveCostCode(tx, context, row.values.costCode, undefined, undefined, true);
    const amount = money(cleanNumber(row.values.amount));
    const forecast = await tx.costForecast.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        costCodeId: costCodeId!,
        amount,
        reason: row.values.reason,
        period: parseDate(row.values.period),
        forecastDate: new Date(),
        status: ForecastStatus.ACTIVE,
        createdById: context.userId,
      },
    });
    const posting = await tx.financialPosting.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        costCodeId,
        postingType: FinancialPostingType.FORECAST,
        sourceType: FinancialSourceType.FORECAST,
        sourceId: forecast.id,
        amount,
        postingDate: new Date(),
      },
    });
    await tx.costForecast.update({
      where: { id: forecast.id },
      data: { financialPostingId: posting.id },
    });
    created += 1;
  }
  return { created };
}

async function applyVariations(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  let created = 0;
  for (const row of rows) {
    const contractorCost = money(cleanNumber(row.values.contractorCost));
    const sellingPrice = money(cleanNumber(row.values.sellingPrice));
    const status = parseVariationStatus(row.values.status);
    const costCodeId = await resolveCostCode(tx, context, row.values.costCode, undefined, undefined);
    await tx.variation.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        variationNo: row.values.variationNo,
        title: row.values.title,
        description: withExtras(row.values.description ?? '', row.extras) || undefined,
        reason: emptyToUndefined(row.values.reason),
        clientInstruction: emptyToUndefined(row.values.clientInstruction),
        instructionDate: row.values.instructionDate ? parseDate(row.values.instructionDate) : undefined,
        costCodeId,
        contractorCost,
        sellingPrice,
        expectedProfit: sellingPrice.minus(contractorCost),
        expectedMargin: sellingPrice.isZero()
          ? money(0)
          : sellingPrice.minus(contractorCost).div(sellingPrice).times(100).toDecimalPlaces(4),
        status,
      },
    });
    created += 1;
  }
  return { created };
}

async function applyClaims(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  const contracts = await tx.contract.findMany({
    where: { projectId: context.projectId, companyId: context.companyId },
  });
  const revised = contracts.reduce((total, item) => total.plus(item.revisedValue), money(0));
  let created = 0;
  for (const row of rows) {
    const previous = await tx.certification.aggregate({
      where: { projectId: context.projectId },
      _sum: { certifiedAmount: true },
    });
    const previousCertified = money(previous._sum.certifiedAmount ?? 0);
    const gross = money(cleanNumber(row.values.workCompleted));
    const retention = row.values.retentionAmount ? money(cleanNumber(row.values.retentionAmount)) : money(0);
    const remaining = revised.minus(previousCertified);
    const currentAmount = gross.minus(previousCertified);
    await tx.progressClaim.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        claimNo: row.values.claimNo,
        periodStart: parseDate(row.values.periodStart),
        periodEnd: parseDate(row.values.periodEnd),
        workCompleted: gross,
        revisedContractValue: revised,
        remainingContractValue: remaining,
        grossAmount: gross,
        retentionAmount: retention,
        previousCertifiedAmount: previousCertified,
        currentAmount,
        netAmount: currentAmount.minus(retention),
      },
    });
    created += 1;
  }
  return { created };
}

async function applyCommitments(tx: Prisma.TransactionClient, rows: MappedRow[], context: ApplyContext) {
  let created = 0;
  for (const row of rows) {
    const costCodeId = await resolveCostCode(tx, context, row.values.costCode, undefined, undefined, true);
    const supplierId = await resolveSupplier(tx, context, row.values.supplierName);
    const amount = money(cleanNumber(row.values.originalAmount));
    const commitment = await tx.commitment.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        costCodeId: costCodeId!,
        supplierId,
        originalAmount: amount,
        remainingAmount: amount,
        status: 'OPEN',
      },
    });
    const posting = await tx.financialPosting.create({
      data: {
        companyId: context.companyId,
        projectId: context.projectId,
        costCodeId,
        postingType: FinancialPostingType.COMMITMENT,
        sourceType: FinancialSourceType.PURCHASE_ORDER,
        sourceId: commitment.id,
        amount,
        postingDate: new Date(),
      },
    });
    await tx.commitment.update({
      where: { id: commitment.id },
      data: { financialPostingId: posting.id },
    });
    created += 1;
  }
  return { created };
}

async function resolveCostCode(
  tx: Prisma.TransactionClient,
  context: ApplyContext,
  code: string | undefined,
  name?: string,
  category?: string,
  required = false,
): Promise<string | undefined> {
  const trimmed = code?.trim();
  if (!trimmed) {
    if (required) {
      throw new Error('Cost code is required');
    }
    return undefined;
  }
  const existing = await tx.costCode.findUnique({
    where: { projectId_code: { projectId: context.projectId, code: trimmed } },
  });
  if (existing) {
    return existing.id;
  }
  if (!context.createMissingCostCodes) {
    throw new Error(`Unknown cost code ${trimmed}`);
  }
  const created = await tx.costCode.create({
    data: {
      companyId: context.companyId,
      projectId: context.projectId,
      code: trimmed,
      name: name?.trim() || trimmed,
      category: parseCategory(category) ?? CostCategory.OTHER,
    },
  });
  return created.id;
}

async function resolveSupplier(
  tx: Prisma.TransactionClient,
  context: ApplyContext,
  name: string | undefined,
): Promise<string | undefined> {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }
  const existing = await tx.supplier.findFirst({
    where: { companyId: context.companyId, name: trimmed },
  });
  if (existing) {
    return existing.id;
  }
  if (!context.createMissingSuppliers) {
    throw new Error(`Unknown supplier ${trimmed}`);
  }
  const created = await tx.supplier.create({
    data: { companyId: context.companyId, name: trimmed },
  });
  return created.id;
}

function parseCategory(value?: string): CostCategory | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '_') as CostCategory;
  return Object.values(CostCategory).includes(normalized) ? normalized : undefined;
}

function parseVariationStatus(value?: string): VariationStatus {
  if (!value?.trim()) {
    return VariationStatus.DRAFT;
  }
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '_') as VariationStatus;
  if (normalized === VariationStatus.SUBMITTED) {
    return VariationStatus.SUBMITTED;
  }
  return VariationStatus.DRAFT;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date ${value}`);
  }
  return date;
}

export function cleanNumber(value: string): string {
  return value
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/^(us\$|usd|zar|r|\$|€|£)+/i, '')
    .replace(/(us\$|usd|zar)$/i, '')
    .trim();
}

function emptyToUndefined(value?: string) {
  return value?.trim() ? value.trim() : undefined;
}

function withExtras(description: string, extras: Record<string, string>) {
  const extraText = Object.entries(extras)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
  if (!extraText) {
    return description;
  }
  return description ? `${description} | ${extraText}` : extraText;
}
