import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  EntityType,
  FinancialPostingType,
  FinancialSourceType,
  Prisma,
  RevenuePostingType,
  VariationRevenueRule,
  VariationStatus,
} from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { money, percentRatio, subtract, zero } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { SequenceService } from '../common/sequence.service';
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
    VariationStatus.CANCELLED,
  ],
  [VariationStatus.APPROVED]: [
    VariationStatus.EXECUTED,
    VariationStatus.REJECTED,
    VariationStatus.CANCELLED,
  ],
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
    private readonly sequences: SequenceService,
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
    const variationNo =
      dto.variationNo ?? (await this.sequences.next(companyId, EntityType.VARIATION, this.prisma));

    const variation = await this.prisma.variation.create({
      data: {
        companyId,
        projectId,
        variationNo,
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
      newData: { projectId, sellingPrice: sellingPrice.toFixed(2), contractorCost: contractorCost.toFixed(2) },
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
    await this.projects.getWritable(companyId, projectId);
    const variation = await this.prisma.variation.findFirst({
      where: { id: variationId, projectId, companyId },
    });
    if (!variation) {
      throw new BadRequestException('Variation not found');
    }
    assertVariationTransitionPermission(permissions, variation.status, next);
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
        await this.postCost(tx, {
          companyId,
          projectId,
          variation: updated,
        });
      } else {
        await tx.revenuePosting.updateMany({
          where: { variationId: variation.id, isReversed: false },
          data: { isReversed: true },
        });
        await tx.financialPosting.updateMany({
          where: {
            sourceType: FinancialSourceType.FORECAST,
            sourceId: variation.id,
            postingType: FinancialPostingType.FORECAST,
            isReversed: false,
          },
          data: { isReversed: true, reversedAt: new Date() },
        });
      }

      const revenue = await this.sumQualifying(tx, projectId);
      const previousApproved = money(contract.revisedValue);
      const nextApproved = money(contract.originalValue).plus(revenue);
      await tx.contract.update({
        where: { id: contract.id },
        data: { revisedValue: nextApproved },
      });
      if (!previousApproved.eq(nextApproved)) {
        await tx.contractRevision.create({
          data: {
            projectId,
            contractId: contract.id,
            previousValue: previousApproved,
            newValue: nextApproved,
            reason: `VO ${variation.variationNo} ${variation.status} → ${next}`,
            createdById: userId,
          },
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
          reason: variation.reason ?? undefined,
          oldData: {
            status: variation.status,
            originalContractValue: contract.originalValue.toFixed(2),
            currentApprovedContractValue: previousApproved.toFixed(2),
          },
          newData: {
            projectId,
            status: next,
            originalContractValue: contract.originalValue.toFixed(2),
            currentApprovedContractValue: nextApproved.toFixed(2),
            sellingPrice: variation.sellingPrice.toFixed(2),
            contractorCost: variation.contractorCost.toFixed(2),
          },
        },
        tx,
      );
    });

    await this.profit.recalculate(companyId, projectId);
    return this.prisma.variation.findUniqueOrThrow({ where: { id: variationId } });
  }

  private async postCost(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      projectId: string;
      variation: { id: string; contractorCost: Prisma.Decimal; costCodeId: string | null };
    },
  ) {
    const amount = money(input.variation.contractorCost);
    if (amount.lte(0)) {
      return;
    }
    await tx.financialPosting.upsert({
      where: {
        sourceType_sourceId_postingType: {
          sourceType: FinancialSourceType.FORECAST,
          sourceId: input.variation.id,
          postingType: FinancialPostingType.FORECAST,
        },
      },
      create: {
        companyId: input.companyId,
        projectId: input.projectId,
        costCodeId: input.variation.costCodeId,
        postingType: FinancialPostingType.FORECAST,
        sourceType: FinancialSourceType.FORECAST,
        sourceId: input.variation.id,
        amount,
        postingDate: new Date(),
      },
      update: { amount, isReversed: false, reversedAt: null },
    });
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
        isReversed: false,
      },
      update: { amount: input.variation.sellingPrice, isReversed: false },
    });
  }

  private async sumQualifying(tx: Prisma.TransactionClient, projectId: string) {
    const rows = await tx.revenuePosting.findMany({
      where: {
        projectId,
        isReversed: false,
        postingType: {
          in: [RevenuePostingType.APPROVED_VARIATION, RevenuePostingType.EXECUTED_VARIATION],
        },
      },
    });
    return rows.reduce((total, row) => total.plus(row.amount), zero());
  }
}

function assertVariationTransitionPermission(
  permissions: string[],
  from: VariationStatus,
  next: VariationStatus,
) {
  const granted = new Set(permissions);
  const commercial =
    next === VariationStatus.APPROVED ||
    next === VariationStatus.REJECTED ||
    next === VariationStatus.EXECUTED ||
    (next === VariationStatus.CANCELLED && from === VariationStatus.APPROVED);
  if (commercial) {
    if (!granted.has('variation.approve')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return;
  }
  if (!granted.has('variation.submit') && !granted.has('variation.approve')) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
