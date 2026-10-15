import { Prisma } from '@prisma/client';
import { money } from '../common/money';

export type AmountBand = {
  minAmount: Prisma.Decimal;
  maxAmount: Prisma.Decimal | null;
  active: boolean;
};

export function matchingApprovalRule<T extends AmountBand>(rules: T[], amount: Prisma.Decimal): T | undefined {
  const value = money(amount);
  return rules.find((rule) => {
    if (!rule.active) {
      return false;
    }
    if (value.lt(rule.minAmount)) {
      return false;
    }
    if (rule.maxAmount != null && value.gt(rule.maxAmount)) {
      return false;
    }
    return true;
  });
}
