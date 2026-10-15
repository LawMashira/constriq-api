import { CostCategory, FinancialPostingType, FinancialSourceType, LeakageType, Prisma } from '@prisma/client';
import { money, zero } from '../common/money';

export type CostDriver = {
  costCodeId: string | null;
  title: string;
  description: string;
  action: string;
  amount: Prisma.Decimal;
  leakageType: LeakageType;
};

type Posting = {
  postingType: FinancialPostingType;
  sourceType: FinancialSourceType;
  amount: Prisma.Decimal;
  costCodeId: string | null;
};

type CodeInfo = {
  id: string;
  code: string;
  name: string;
  category: CostCategory;
};

export function explainCostOverruns(input: {
  profitAtRisk: Prisma.Decimal;
  budgetLines: Array<{ costCodeId: string; originalAmount: Prisma.Decimal }>;
  postings: Posting[];
  costCodes: CodeInfo[];
}): CostDriver[] {
  if (input.profitAtRisk.lte(0)) {
    return [];
  }

  const codes = new Map(input.costCodes.map((item) => [item.id, item]));
  const originalByCode = new Map<string, Prisma.Decimal>();
  for (const line of input.budgetLines) {
    originalByCode.set(line.costCodeId, money(originalByCode.get(line.costCodeId) ?? 0).plus(line.originalAmount));
  }

  const byCode = new Map<
    string,
    { actual: Prisma.Decimal; committed: Prisma.Decimal; forecast: Prisma.Decimal; sources: Map<FinancialSourceType, Prisma.Decimal> }
  >();
  for (const posting of input.postings) {
    const key = posting.costCodeId ?? 'unallocated';
    const row = byCode.get(key) ?? {
      actual: zero(),
      committed: zero(),
      forecast: zero(),
      sources: new Map(),
    };
    if (posting.postingType === FinancialPostingType.ACTUAL) {
      row.actual = row.actual.plus(money(posting.amount));
    } else if (posting.postingType === FinancialPostingType.COMMITMENT) {
      row.committed = row.committed.plus(money(posting.amount));
    } else {
      row.forecast = row.forecast.plus(money(posting.amount));
    }
    if (posting.postingType !== FinancialPostingType.FORECAST) {
      row.sources.set(posting.sourceType, money(row.sources.get(posting.sourceType) ?? 0).plus(posting.amount));
    }
    byCode.set(key, row);
  }

  const drivers: CostDriver[] = [];

  for (const [costCodeId, row] of byCode) {
    if (costCodeId === 'unallocated') {
      continue;
    }
    const original = money(originalByCode.get(costCodeId) ?? 0);
    const finalCost = row.actual.plus(row.committed).plus(row.forecast);
    const extra = finalCost.minus(original);
    if (extra.lte(0)) {
      continue;
    }
    const code = codes.get(costCodeId);
    const source = topSource(row.sources);
    const label = driverLabel(source, code);
    drivers.push({
      costCodeId,
      title: `${label} is over the original budget`,
      description: `${label} is ${rand(extra)} above the original budget.`,
      action: actionFor(source, code?.category),
      amount: extra,
      leakageType: leakageTypeFor(source, code?.category),
    });
  }

  return drivers.sort((left, right) => right.amount.comparedTo(left.amount)).slice(0, 5);
}

function topSource(sources: Map<FinancialSourceType, Prisma.Decimal>): FinancialSourceType | null {
  let best: FinancialSourceType | null = null;
  let bestAmount = zero();
  for (const [source, amount] of sources) {
    if (amount.gt(bestAmount)) {
      best = source;
      bestAmount = amount;
    }
  }
  return best;
}

function driverLabel(source: FinancialSourceType | null, code?: CodeInfo): string {
  if (source === FinancialSourceType.LABOUR_RECORD) {
    return 'Labour';
  }
  if (source === FinancialSourceType.PLANT_RECORD) {
    return 'Plant';
  }
  if (source === FinancialSourceType.PURCHASE_ORDER) {
    return 'Purchase orders';
  }
  if (source === FinancialSourceType.SUPPLIER_INVOICE) {
    return 'Supplier invoices';
  }
  if (source === FinancialSourceType.SUBCONTRACT || source === FinancialSourceType.SUBCONTRACT_CLAIM) {
    return 'Subcontract';
  }
  if (source === FinancialSourceType.MANUAL_COST) {
    return categoryLabel(code?.category) ?? code?.name ?? 'Direct cost';
  }
  return categoryLabel(code?.category) ?? code?.name ?? code?.code ?? 'This cost code';
}

function actionFor(source: FinancialSourceType | null, category?: CostCategory): string {
  if (source === FinancialSourceType.LABOUR_RECORD || category === CostCategory.LABOUR) {
    return 'Open Labour and check hours, overtime and rates.';
  }
  if (source === FinancialSourceType.PLANT_RECORD || category === CostCategory.PLANT || category === CostCategory.EQUIPMENT) {
    return 'Open Plant and check hire hours and rates.';
  }
  if (source === FinancialSourceType.PURCHASE_ORDER || source === FinancialSourceType.SUPPLIER_INVOICE) {
    return 'Open Procurement and check purchase orders and invoices.';
  }
  if (source === FinancialSourceType.SUBCONTRACT || source === FinancialSourceType.SUBCONTRACT_CLAIM) {
    return 'Open Subcontract and check claims against the subcontract value.';
  }
  if (source === FinancialSourceType.MANUAL_COST) {
    return 'Open Actual costs and check the latest entries.';
  }
  return 'Open Forecast and reduce remaining cost if the work is already captured.';
}

function leakageTypeFor(source: FinancialSourceType | null, category?: CostCategory): LeakageType {
  if (source === FinancialSourceType.LABOUR_RECORD || category === CostCategory.LABOUR) {
    return LeakageType.LABOUR_OVERRUN;
  }
  if (source === FinancialSourceType.SUBCONTRACT || source === FinancialSourceType.SUBCONTRACT_CLAIM || category === CostCategory.SUBCONTRACTORS) {
    return LeakageType.SUBCONTRACTOR_OVERRUN;
  }
  if (category === CostCategory.MATERIALS) {
    return LeakageType.MATERIAL_OVERRUN;
  }
  return LeakageType.BUDGET_OVERRUN;
}

function categoryLabel(category?: CostCategory): string | undefined {
  if (!category) {
    return undefined;
  }
  const labels: Partial<Record<CostCategory, string>> = {
    MATERIALS: 'Materials',
    LABOUR: 'Labour',
    SUBCONTRACTORS: 'Subcontractors',
    PLANT: 'Plant',
    EQUIPMENT: 'Equipment',
    TRANSPORT: 'Transport',
    PROFESSIONAL_SERVICES: 'Professional services',
    SITE_OVERHEADS: 'Site overheads',
    GENERAL_EXPENSES: 'General expenses',
    PRELIMINARIES: 'Preliminaries',
    OTHER: 'Other costs',
  };
  return labels[category];
}

function rand(value: Prisma.Decimal): string {
  return `R ${money(value).toFixed(2)}`;
}
