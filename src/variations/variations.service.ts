import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  EntityType,
  Prisma,
  RevenuePostingType,
  VariationRevenueRule,
  VariationStatus,
} from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { money, percentRatio, subtract } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { variationQualifiesForRevenue } from '../profit-engine/profit-formulas';
import { CreateVariationDto } from './dto/create-variation.dto';

const TRANSITIONS: Record<string, VariationStatus[]> = {
  [VariationStatus.DRAFT]: [VariationStatus.SUBMITTED, VariationStatus.CANCELLED],
  [VariationStatus.SUBMITTED]: [
    VariationStatus.APPROVED,
    VariationStatus.REJECTED,
    VariationStatus.DRAFT,
  ],
  [VariationStatus.APPROVED]: [VariationStatus.EXECUTED, VariationStatus.REJECTED],
  [VariationStatus.EXECUTED]: [],
  [VariationStatus.REJECTED]: [],
  [VariationStatus.CANCELLED]: [],
};

@Injectable()
export class VariationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly profit: ProfitEngineService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.variation.findMany({
      where: { projectId, companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(companyId: string, userId: string, projectId: string, dto: CreateVariationDto) {
    await this.projects.getWritable(companyId, projectId);
    const contractorCost = money(dto.contractorCost);
    const sellingPrice = money(dto.sellingPrice);
    const expectedProfit = subtract(sellingPrice, contractorCost);
    const expectedMargin = percentRatio(expectedProfit, sellingPrice) ?? money(0);

    const variation = await this.prisma.variation.create({
      data: {
        companyId,
        projectId,
        variationNo: dto.variationNo,
        title: dto.title,
        description: dto.description,
        reason: dto.reason,
        clientInstruction: dto.clientInstruction,
        instructionDate: dto.instructionDate ? new Date(dto.instructionDate) : undefined,
        costCodeId: dto.costCodeId,
        boqItemId: dto.boqItemId,
        contractorCost,
        sellingPrice,
        expectedProfit,
        expectedMargin,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.CREATE,
      module: 'VARIATIONS',
      entityType: EntityType.VARIATION,
      entityId: variation.id,
      description: `VO ${variation.variationNo} drafted; not revenue`,
      newData: { projectId },
    });
    return variation;
  }

  async transition(
    companyId: string,
    userId: string,
    permissions: string[],
    projectId: string,
    variationId: string,
    next: VariationStatus,
  ) {
    assertVariationTransitionPermission(permissions, next);
    await this.projects.getWritable(companyId, projectId);
    const variation = await this.prisma.variation.findFirst({
      where: { id: variationId, projectId, companyId },
    });
    if (!variation) {
      throw new BadRequestException('Variation not found');
    }
    if (!TRANSITIONS[variation.status]?.includes(next)) {
      throw new BadRequestException(`Cannot move variation from ${variation.status} to ${next}`);
    }

    const settings = await this.prisma.companySetting.findUnique({ where: { companyId } });
    const rule = settings?.variationRevenueRule ?? VariationRevenueRule.APPROVED;
    const contract = await this.prisma.contract.findFirst({ where: { projectId, companyId } });
    if (!contract) {
      throw new BadRequestException('Create a contract before changing variation status');
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.variation.update({
        where: { id: variation.id },
        data: {
          status: next,
          submittedAt: next === VariationStatus.SUBMITTED ? new Date() : variation.submittedAt,
          approvedAt: next === VariationStatus.APPROVED ? new Date() : variation.approvedAt,
          executedAt: next === VariationStatus.EXECUTED ? new Date() : variation.executedAt,
        },
      });

      if (variationQualifiesForRevenue(updated.status, rule)) {
        await this.postRevenue(tx, {
          companyId,
          projectId,
          contractId: contract.id,
          variation: updated,
          rule,
        });
        const revenue = await this.sumQualifying(tx, projectId);
        await tx.contract.update({
          where: { id: contract.id },
          data: { revisedValue: money(contract.originalValue).plus(revenue) },
        });
      }

      await this.audit.record(
        {
          companyId,
          userId,
          action: next === VariationStatus.APPROVED ? AuditAction.APPROVE : AuditAction.UPDATE,
          module: 'VARIATIONS',
          entityType: EntityType.VARIATION,
          entityId: variation.id,
          description: `VO ${variation.variationNo} ${variation.status} → ${next}`,
          newData: { projectId },
        },
        tx,
      );
    });

    await this.profit.recalculate(companyId, projectId);
    return this.prisma.variation.findUniqueOrThrow({ where: { id: variationId } });
  }

  private async postRevenue(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      projectId: string;
      contractId: string;
      variation: { id: string; sellingPrice: Prisma.Decimal; status: VariationStatus; costCodeId: string | null };
      rule: VariationRevenueRule;
    },
  ) {
    const postingType =
      input.rule === VariationRevenueRule.EXECUTED
        ? RevenuePostingType.EXECUTED_VARIATION
        : RevenuePostingType.APPROVED_VARIATION;
    await tx.revenuePosting.upsert({
      where: { variationId_postingType: { variationId: input.variation.id, postingType } },
      create: {
        companyId: input.companyId,
        projectId: input.projectId,
        contractId: input.contractId,
        variationId: input.variation.id,
        costCodeId: input.variation.costCodeId,
        postingType,
        amount: input.variation.sellingPrice,
        postingDate: new Date(),
      },
      update: { amount: input.variation.sellingPrice },
    });
  }

  private async sumQualifying(tx: Prisma.TransactionClient, projectId: string) {
    const rows = await tx.revenuePosting.findMany({
      where: {
        projectId,
        postingType: {
          in: [RevenuePostingType.APPROVED_VARIATION, RevenuePostingType.EXECUTED_VARIATION],
        },
      },
    });
    return rows.reduce((total, row) => total.plus(row.amount), money(0));
  }
}

const COMMERCIAL_VARIATION_STATUSES: VariationStatus[] = [
  VariationStatus.APPROVED,
  VariationStatus.REJECTED,
  VariationStatus.EXECUTED,
];

function assertVariationTransitionPermission(permissions: string[], next: VariationStatus) {
  const granted = new Set(permissions);
  if (COMMERCIAL_VARIATION_STATUSES.includes(next)) {
    if (!granted.has('variation.approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return;
  }
  if (!granted.has('variation.submit') && !granted.has('variation.approve')) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
