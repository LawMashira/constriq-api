import { CostCategory, Prisma } from '@prisma/client';
import { money, sum, zero } from '../common/money';

export const EXPECTED_COST_BUCKETS = [
  { key: 'materials', category: CostCategory.MATERIALS, code: 'MAT', name: 'Materials' },
  { key: 'labour', category: CostCategory.LABOUR, code: 'LAB', name: 'Labour' },
  { key: 'transport', category: CostCategory.TRANSPORT, code: 'TRN', name: 'Transport' },
  { key: 'equipment', category: CostCategory.EQUIPMENT, code: 'EQP', name: 'Equipment' },
  { key: 'subcontractors', category: CostCategory.SUBCONTRACTORS, code: 'SUB', name: 'Subcontractors' },
  { key: 'other', category: CostCategory.OTHER, code: 'OTH', name: 'Other expenses' },
] as const;

export type ExpectedCostBreakdown = Partial<Record<(typeof EXPECTED_COST_BUCKETS)[number]['key'], string>>;

export type ExpectedCostLine = {
  code: string;
  name: string;
  category: CostCategory;
  amount: Prisma.Decimal;
};

export function resolveExpectedCostLines(input: {
  expectedTotalCost?: string;
  expectedCosts?: ExpectedCostBreakdown;
}): { lines: ExpectedCostLine[]; total: Prisma.Decimal; incomplete: boolean } {
  const lines = EXPECTED_COST_BUCKETS.flatMap((bucket) => {
    const raw = input.expectedCosts?.[bucket.key];
    if (raw == null || raw === '') {
      return [];
    }
    const amount = money(raw);
    if (amount.lte(0)) {
      return [];
    }
    return [{ code: bucket.code, name: bucket.name, category: bucket.category, amount }];
  });
  const breakdownTotal = sum(lines.map((line) => line.amount));
  if (lines.length && input.expectedTotalCost != null && input.expectedTotalCost !== '') {
    const declared = money(input.expectedTotalCost);
    if (!declared.eq(breakdownTotal)) {
      throw new Error(
        `Expected total cost ${declared.toFixed(2)} does not match the cost breakdown ${breakdownTotal.toFixed(2)}`,
      );
    }
  }
  if (lines.length) {
    return { lines, total: breakdownTotal, incomplete: false };
  }
  if (input.expectedTotalCost != null && input.expectedTotalCost !== '') {
    const total = money(input.expectedTotalCost);
    if (total.lt(0)) {
      throw new Error('Expected total cost cannot be negative');
    }
    if (total.eq(0)) {
      return { lines: [], total: zero(), incomplete: true };
    }
    return {
      lines: [
        {
          code: 'GEN',
          name: 'Project expected costs',
          category: CostCategory.OTHER,
          amount: total,
        },
      ],
      total,
      incomplete: false,
    };
  }
  return { lines: [], total: zero(), incomplete: true };
}

export function originalExpectedProfit(contractValue: Prisma.Decimal, expectedCost: Prisma.Decimal) {
  return money(contractValue).minus(money(expectedCost));
}
