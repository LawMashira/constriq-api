import { Injectable } from '@nestjs/common';
import { ReconciliationStatus } from '@prisma/client';
import { money } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { MappedRow } from '../excel/mapping';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  async compareAccountingCosts(companyId: string, projectId: string, rows: MappedRow[]) {
    await this.projects.get(companyId, projectId);
    const internals = await this.prisma.actualCost.findMany({
      where: { companyId, projectId },
    });
    const unmatchedInternal = [...internals];
    const unmatchedExternal: MappedRow[] = [];
    const matches: Array<{ status: ReconciliationStatus }> = [];

    for (const row of rows) {
      const amount = money(row.values.amount.replace(/,/g, ''));
      const reference = row.values.reference?.trim();
      const index = unmatchedInternal.findIndex((item) => {
        if (reference && item.reference === reference) {
          return true;
        }
        return item.amount.equals(amount) && (!reference || !item.reference);
      });
      if (index < 0) {
        unmatchedExternal.push(row);
        continue;
      }
      const internal = unmatchedInternal.splice(index, 1)[0];
      const variance = money(internal.amount).minus(amount);
      const record = await this.prisma.reconciliationRecord.create({
        data: {
          companyId,
          projectId,
          sourceType: 'ACTUAL_COST',
          sourceId: internal.id,
          externalType: 'ACCOUNTING_COST',
          externalId: reference || `row-${row.rowNumber}`,
          internalAmount: internal.amount,
          externalAmount: amount,
          variance,
          status: variance.isZero() ? ReconciliationStatus.MATCHED : ReconciliationStatus.VARIANCE,
          notes: variance.isZero() ? undefined : 'Amounts differ; CONSTRIQ record was not overwritten',
        },
      });
      matches.push(record);
    }

    return {
      matched: matches.length,
      unmatchedInternal: unmatchedInternal.map((item) => ({
        id: item.id,
        amount: item.amount.toFixed(2),
        reference: item.reference,
      })),
      unmatchedExternal: unmatchedExternal.map((row) => ({
        rowNumber: row.rowNumber,
        amount: row.values.amount,
        reference: row.values.reference,
      })),
      differences: matches.filter((item) => item.status === ReconciliationStatus.VARIANCE),
    };
  }

  list(companyId: string, projectId: string) {
    return this.prisma.reconciliationRecord.findMany({
      where: { companyId, projectId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
