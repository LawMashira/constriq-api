import { CostCategory, FinancialPostingType, FinancialSourceType, LeakageType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { explainCostOverruns } from './profit-explanations';

const d = (value: string) => new Prisma.Decimal(value);

describe('explainCostOverruns', () => {
  it('names labour instead of asking the user to hunt cost codes', () => {
    const drivers = explainCostOverruns({
      profitAtRisk: d('14500.00'),
      budgetLines: [{ costCodeId: 'labour', originalAmount: d('74000.00') }],
      costCodes: [{ id: 'labour', code: 'PRELIM', name: 'Preliminaries', category: CostCategory.LABOUR }],
      postings: [
        {
          costCodeId: 'labour',
          postingType: FinancialPostingType.ACTUAL,
          sourceType: FinancialSourceType.LABOUR_RECORD,
          amount: d('14500.00'),
        },
        {
          costCodeId: 'labour',
          postingType: FinancialPostingType.FORECAST,
          sourceType: FinancialSourceType.FORECAST,
          amount: d('74000.00'),
        },
      ],
    });
    expect(drivers[0]?.title).toBe('Labour is over the original budget');
    expect(drivers[0]?.description).toBe('Labour is R 14500.00 above the original budget.');
    expect(drivers[0]?.action).toContain('Labour');
    expect(drivers[0]?.leakageType).toBe(LeakageType.LABOUR_OVERRUN);
  });

  it('does not treat approved variation cost as an original-budget overrun', () => {
    const drivers = explainCostOverruns({
      profitAtRisk: d('10000.00'),
      budgetLines: [{ costCodeId: 'gen', originalAmount: d('80000.00') }],
      variationCosts: [{ costCodeId: 'gen', amount: d('10000.00') }],
      costCodes: [{ id: 'gen', code: 'GEN', name: 'Project expected costs', category: CostCategory.OTHER }],
      postings: [
        {
          costCodeId: 'gen',
          postingType: FinancialPostingType.FORECAST,
          sourceType: FinancialSourceType.FORECAST,
          amount: d('90000.00'),
        },
      ],
    });
    expect(drivers).toEqual([]);
  });
});
