import { Injectable } from '@nestjs/common';
import { AuditAction, EntityType, FinancialSourceType } from '@prisma/client';
import { postActualCost } from '../common/actual-cost-posting';
import { AuditService } from '../common/audit.service';
import { money } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { CreateActualCostDto } from './dto/create-actual-cost.dto';

@Injectable()
export class CostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly profit: ProfitEngineService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.actualCost.findMany({
      where: { companyId, projectId },
      orderBy: { transactionDate: 'desc' },
    });
  }

  async create(companyId: string, userId: string, projectId: string, dto: CreateActualCostDto) {
    await this.projects.getWritable(companyId, projectId);
    const unallocated = !dto.costCodeId;
    const cost = await this.prisma.$transaction(async (tx) => {
      const posted = await postActualCost(tx, {
        companyId,
        projectId,
        costCodeId: dto.costCodeId,
        createdById: userId,
        description: dto.description,
        amount: money(dto.amount),
        transactionDate: new Date(dto.transactionDate),
        sourceType: FinancialSourceType.MANUAL_COST,
        sourceId: `pending-${Date.now()}`,
        supplierId: dto.supplierId,
        reference: dto.reference,
      });
      await tx.financialPosting.update({
        where: { id: posted.posting.id },
        data: { sourceId: posted.cost.id },
      });
      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'COSTS',
          entityType: EntityType.ACTUAL_COST,
          entityId: posted.cost.id,
          description: unallocated ? 'Unallocated actual cost flagged for review' : 'Actual cost posted',
        },
        tx,
      );
      return posted.cost;
    });
    await this.profit.recalculate(companyId, projectId);
    return cost;
  }
}
