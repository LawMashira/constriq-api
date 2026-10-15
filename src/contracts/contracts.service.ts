import { ConflictException, Injectable } from '@nestjs/common';
import { AuditAction, EntityType, RevenuePostingType } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { money, zero } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { CreateContractDto } from './dto/create-contract.dto';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly profit: ProfitEngineService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.contract.findMany({
      where: { projectId, companyId },
      include: { revenuePostings: true },
    });
  }

  async create(companyId: string, userId: string, projectId: string, dto: CreateContractDto) {
    await this.projects.getWritable(companyId, projectId);
    const original = money(dto.originalValue);
    const existing = await this.prisma.contract.findFirst({ where: { projectId, companyId } });
    if (existing) {
      throw new ConflictException(
        'This project already has an original contract. Record additional work as a variation.',
      );
    }

    const contract = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          companyId,
          projectId,
          contractNo: dto.contractNo,
          title: dto.title,
          originalValue: original,
          revisedValue: original,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });
      await tx.revenuePosting.create({
        data: {
          companyId,
          projectId,
          contractId: created.id,
          postingType: RevenuePostingType.CONTRACT_BASE,
          amount: original,
          postingDate: created.startDate ?? new Date(),
        },
      });
      await tx.contractRevision.create({
        data: {
          projectId,
          contractId: created.id,
          previousValue: zero(),
          newValue: original,
          reason: 'Original contract baseline recorded',
          createdById: userId,
        },
      });
      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'CONTRACTS',
          entityType: EntityType.CONTRACT,
          entityId: created.id,
          description: 'Contract created with original value',
          newData: { originalValue: original.toFixed(2) },
        },
        tx,
      );
      return created;
    });

    await this.profit.recalculate(companyId, projectId);
    return contract;
  }
}
