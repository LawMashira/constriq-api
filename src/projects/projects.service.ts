import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  CostCategory,
  EntityType,
  FinancialPostingType,
  FinancialSourceType,
  ForecastStatus,
  PartyType,
  Prisma,
  RevenuePostingType,
} from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { money, percentRatio, zero } from '../common/money';
import {
  AUTO_REMAINING_FORECAST_REASONS,
  isLumpCostCode,
  ORIGINAL_FORECAST_REASON,
} from '../common/remaining-forecast';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { EXPECTED_COST_BUCKETS, resolveExpectedCostLines } from './no-boq-baseline';

const BASELINE_COST_CODES = new Set<string>([...EXPECTED_COST_BUCKETS.map((bucket) => bucket.code), 'GEN']);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
    private readonly profit: ProfitEngineService,
  ) {}

  list(companyId: string) {
    return this.prisma.project.findMany({
      where: { companyId },
      include: { client: true, health: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(companyId: string, userId: string, dto: CreateProjectDto) {
    let costPlan;
    try {
      costPlan = resolveExpectedCostLines({
        expectedTotalCost: dto.expectedTotalCost,
        expectedCosts: dto.expectedCosts,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid expected costs');
    }

    if (dto.originalContractValue && money(dto.originalContractValue).lt(0)) {
      throw new BadRequestException('Original contract value cannot be negative');
    }

    if (dto.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, companyId },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const code = dto.code ?? (await this.sequences.next(companyId, EntityType.PROJECT, tx, 'PRJ'));
      const duplicate = await tx.project.findUnique({
        where: { companyId_code: { companyId, code } },
      });
      if (duplicate) {
        throw new ConflictException('Project code already exists');
      }

      const created = await tx.project.create({
        data: {
          companyId,
          code,
          name: dto.name,
          clientId: dto.clientId,
          projectManagerId: dto.projectManagerId,
          siteAddress: dto.siteAddress,
          contractNo: dto.contractNo,
          projectType: dto.projectType,
          status: dto.status,
          contractStartDate: dto.contractStartDate ? new Date(dto.contractStartDate) : undefined,
          plannedCompletionDate: dto.plannedCompletionDate
            ? new Date(dto.plannedCompletionDate)
            : undefined,
          notes: dto.notes,
          usesBoq: dto.usesBoq ?? false,
        },
      });

      if (dto.originalContractValue && money(dto.originalContractValue).gt(0)) {
        await this.seedOriginalContract(tx, {
          companyId,
          userId,
          project: created,
          originalValue: money(dto.originalContractValue),
          contractNo: dto.contractNo,
        });
      }

      if (costPlan.lines.length) {
        await this.seedOriginalCosts(tx, {
          companyId,
          userId,
          projectId: created.id,
          lines: costPlan.lines,
        });
      }

      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'PROJECTS',
          entityType: EntityType.PROJECT,
          entityId: created.id,
          description: `Project ${created.code} created${created.usesBoq ? '' : ' without a BOQ'}`,
          newData: {
            originalContractValue: dto.originalContractValue ?? '0.00',
            expectedTotalCost: costPlan.total.toFixed(2),
            usesBoq: created.usesBoq,
          },
        },
        tx,
      );
      return created;
    });

    await this.profit.recalculate(companyId, project.id);
    return this.get(companyId, project.id);
  }

  async get(companyId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId },
      include: {
        client: true,
        contracts: { include: { revisions: { orderBy: { createdAt: 'asc' } } } },
        budget: { include: { lines: { include: { costCode: true } }, revisions: true } },
        health: true,
        contacts: true,
        boqs: { select: { id: true, name: true, version: true, isActive: true } },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    const snapshot = await this.profit.compute(companyId, id);
    const originalContractValue = snapshot.originalContractValue;
    const expectedMargin = percentRatio(snapshot.expectedProfit, snapshot.originalContractValue);
    return {
      ...project,
      usesBoq: project.usesBoq || project.boqs.length > 0,
      financials: {
        originalContractValue: originalContractValue.toFixed(2),
        currentApprovedContractValue: snapshot.expectedRevenue.toFixed(2),
        approvedVariations: snapshot.qualifyingVariationRevenue.toFixed(2),
        pendingVariations: snapshot.unapprovedVariationExposure.toFixed(2),
        originalExpectedCosts: snapshot.originalBudget.toFixed(2),
        currentApprovedBudget: snapshot.currentBudget.toFixed(2),
        actualCosts: snapshot.actualCost.toFixed(2),
        outstandingCommitments: snapshot.openCommittedCost.toFixed(2),
        forecastUncommittedCost: snapshot.forecastUncommittedCost.toFixed(2),
        forecastFinalCosts: snapshot.forecastFinalCost.toFixed(2),
        originalExpectedProfit: snapshot.originalExpectedProfit.toFixed(2),
        originalExpectedMargin: expectedMargin ? expectedMargin.toFixed(4) : null,
        currentForecastProfit: snapshot.forecastProfit.toFixed(2),
        profitAtRisk: snapshot.profitAtRisk.toFixed(2),
        costEstimateIncomplete: snapshot.costEstimateIncomplete,
      },
    };
  }

  async update(companyId: string, userId: string, id: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException('Project not found');
    }

    const { originalContractValue, expectedTotalCost, expectedCosts, ...fields } = dto;

    if (originalContractValue && money(originalContractValue).lt(0)) {
      throw new BadRequestException('Original contract value cannot be negative');
    }

    let costPlan: ReturnType<typeof resolveExpectedCostLines> | undefined;
    if (expectedTotalCost !== undefined || expectedCosts !== undefined) {
      try {
        costPlan = resolveExpectedCostLines({ expectedTotalCost, expectedCosts });
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Invalid expected costs');
      }
    }

    if (fields.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: fields.clientId, companyId },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
    }

    if (fields.code && fields.code !== existing.code) {
      const duplicate = await this.prisma.project.findUnique({
        where: { companyId_code: { companyId, code: fields.code } },
      });
      if (duplicate) {
        throw new ConflictException('Project code already exists');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: {
          code: fields.code,
          name: fields.name,
          clientId: fields.clientId === undefined ? undefined : fields.clientId || null,
          projectManagerId:
            fields.projectManagerId === undefined ? undefined : fields.projectManagerId || null,
          siteAddress: fields.siteAddress,
          contractNo: fields.contractNo,
          projectType: fields.projectType,
          status: fields.status,
          notes: fields.notes,
          usesBoq: fields.usesBoq,
          contractStartDate: fields.contractStartDate ? new Date(fields.contractStartDate) : undefined,
          plannedCompletionDate: fields.plannedCompletionDate
            ? new Date(fields.plannedCompletionDate)
            : undefined,
        },
      });

      if (originalContractValue !== undefined) {
        await this.applyOriginalContract(tx, {
          companyId,
          userId,
          project,
          originalValue: money(originalContractValue),
          contractNo: fields.contractNo ?? project.contractNo ?? undefined,
        });
      }

      if (costPlan) {
        await this.applyOriginalCosts(tx, {
          companyId,
          userId,
          projectId: id,
          lines: costPlan.lines,
          total: costPlan.total,
        });
      }

      await this.dropDuplicateLumpRemaining(tx, id);

      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.UPDATE,
          module: 'PROJECTS',
          entityType: EntityType.PROJECT,
          entityId: id,
          description: `Project ${project.code} updated`,
          newData: dto as object,
        },
        tx,
      );
    });

    await this.profit.recalculate(companyId, id);
    return this.get(companyId, id);
  }

  async addContact(
    companyId: string,
    projectId: string,
    dto: { partyType: PartyType; name: string; email?: string; phone?: string; role?: string },
  ) {
    await this.get(companyId, projectId);
    return this.prisma.projectContact.create({
      data: { projectId, ...dto },
    });
  }

  async addUser(companyId: string, projectId: string, userId: string, roleId?: string) {
    await this.get(companyId, projectId);
    const membership = await this.prisma.companyMembership.findFirst({
      where: { companyId, userId },
    });
    if (!membership) {
      throw new NotFoundException('User is not a member of this company');
    }
    return this.prisma.projectUser.create({
      data: { projectId, userId, roleId },
    });
  }

  async listTeam(companyId: string, projectId: string) {
    await this.get(companyId, projectId);
    return this.prisma.projectUser.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true } }, role: true },
    });
  }

  private async applyOriginalContract(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      project: { id: string; name: string; contractNo: string | null; contractStartDate: Date | null };
      originalValue: Prisma.Decimal;
      contractNo?: string;
    },
  ) {
    const contract = await tx.contract.findFirst({
      where: { projectId: input.project.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!contract) {
      if (input.originalValue.gt(0)) {
        await this.seedOriginalContract(tx, input);
      }
      return;
    }

    const variationExtra = money(contract.revisedValue).minus(contract.originalValue);
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        originalValue: input.originalValue,
        revisedValue: input.originalValue.plus(variationExtra),
        ...(input.contractNo ? { contractNo: input.contractNo } : {}),
      },
    });
    const baseUpdated = await tx.revenuePosting.updateMany({
      where: {
        projectId: input.project.id,
        contractId: contract.id,
        postingType: RevenuePostingType.CONTRACT_BASE,
        isReversed: false,
      },
      data: { amount: input.originalValue },
    });
    if (baseUpdated.count === 0 && input.originalValue.gt(0)) {
      await tx.revenuePosting.create({
        data: {
          companyId: input.companyId,
          projectId: input.project.id,
          contractId: contract.id,
          postingType: RevenuePostingType.CONTRACT_BASE,
          amount: input.originalValue,
          postingDate: contract.startDate ?? new Date(),
        },
      });
    }
    await tx.contractRevision.create({
      data: {
        projectId: input.project.id,
        contractId: contract.id,
        previousValue: contract.originalValue,
        newValue: input.originalValue,
        reason: 'Original contract baseline corrected',
        createdById: input.userId,
      },
    });
  }

  private async applyOriginalCosts(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      projectId: string;
      lines: Array<{ code: string; name: string; category: CostCategory; amount: Prisma.Decimal }>;
      total: Prisma.Decimal;
    },
  ) {
    const budget = await tx.projectBudget.findUnique({
      where: { projectId: input.projectId },
      include: { lines: { include: { costCode: true } } },
    });
    if (!budget) {
      if (input.lines.length) {
        await this.seedOriginalCosts(tx, {
          companyId: input.companyId,
          userId: input.userId,
          projectId: input.projectId,
          lines: input.lines,
        });
      }
      return;
    }

    const extra = money(budget.currentAmount).minus(budget.originalAmount);
    await tx.projectBudget.update({
      where: { id: budget.id },
      data: {
        originalAmount: input.total,
        currentAmount: input.total.plus(extra),
      },
    });

    const wanted = new Map(input.lines.map((line) => [line.code, line]));
    const baselineLines = budget.lines.filter((line) => BASELINE_COST_CODES.has(line.costCode.code));
    const structuredLines = budget.lines.filter((line) => !BASELINE_COST_CODES.has(line.costCode.code));
    const lumpPlan =
      input.lines.length <= 1 && input.lines.every((line) => isLumpCostCode(line.code));

    if (structuredLines.length && lumpPlan) {
      const structuredSum = structuredLines.reduce((acc, line) => acc.plus(line.originalAmount), zero());
      let allocated = zero();
      for (const [index, line] of structuredLines.entries()) {
        const share = structuredSum.gt(0)
          ? input.total.times(line.originalAmount).div(structuredSum)
          : input.total.div(structuredLines.length);
        const amount =
          index === structuredLines.length - 1 ? input.total.minus(allocated) : money(share.toFixed(2));
        allocated = allocated.plus(amount);
        const lineExtra = money(line.currentAmount).minus(line.originalAmount);
        await tx.projectBudgetLine.update({
          where: { id: line.id },
          data: { originalAmount: amount, currentAmount: amount.plus(lineExtra) },
        });
        await this.syncOriginalForecast(tx, {
          companyId: input.companyId,
          userId: input.userId,
          projectId: input.projectId,
          costCodeId: line.costCodeId,
          amount,
        });
      }
      for (const line of baselineLines) {
        const lineExtra = money(line.currentAmount).minus(line.originalAmount);
        await tx.projectBudgetLine.update({
          where: { id: line.id },
          data: { originalAmount: zero(), currentAmount: lineExtra },
        });
        await this.syncOriginalForecast(tx, {
          companyId: input.companyId,
          userId: input.userId,
          projectId: input.projectId,
          costCodeId: line.costCodeId,
          amount: zero(),
        });
      }
      return;
    }

    for (const line of structuredLines) {
      await this.syncOriginalForecast(tx, {
        companyId: input.companyId,
        userId: input.userId,
        projectId: input.projectId,
        costCodeId: line.costCodeId,
        amount: zero(),
      });
    }

    const codesToTouch = new Set([...wanted.keys(), ...baselineLines.map((line) => line.costCode.code)]);

    for (const code of codesToTouch) {
      const plan = wanted.get(code);
      const amount = plan?.amount ?? zero();
      let costCode = await tx.costCode.findUnique({
        where: { projectId_code: { projectId: input.projectId, code } },
      });
      if (!costCode && plan) {
        costCode = await tx.costCode.create({
          data: {
            companyId: input.companyId,
            projectId: input.projectId,
            code: plan.code,
            name: plan.name,
            category: plan.category,
          },
        });
      }
      if (!costCode) {
        continue;
      }

      const existingLine = budget.lines.find((line) => line.costCodeId === costCode.id);
      const lineExtra = existingLine
        ? money(existingLine.currentAmount).minus(existingLine.originalAmount)
        : zero();
      if (existingLine) {
        await tx.projectBudgetLine.update({
          where: { id: existingLine.id },
          data: {
            originalAmount: amount,
            currentAmount: amount.plus(lineExtra),
          },
        });
      } else if (amount.gt(0)) {
        await tx.projectBudgetLine.create({
          data: {
            budgetId: budget.id,
            costCodeId: costCode.id,
            originalAmount: amount,
            currentAmount: amount,
          },
        });
      }

      await this.syncOriginalForecast(tx, {
        companyId: input.companyId,
        userId: input.userId,
        projectId: input.projectId,
        costCodeId: costCode.id,
        amount,
      });
    }
  }

  private async syncOriginalForecast(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      projectId: string;
      costCodeId: string;
      amount: Prisma.Decimal;
    },
  ) {
    const forecasts = await tx.costForecast.findMany({
      where: {
        projectId: input.projectId,
        costCodeId: input.costCodeId,
        reason: { in: [...AUTO_REMAINING_FORECAST_REASONS] },
        status: ForecastStatus.ACTIVE,
      },
      orderBy: { createdAt: 'asc' },
    });
    const forecast = forecasts[0];
    for (const extra of forecasts.slice(1)) {
      await this.reverseForecast(tx, extra);
    }

    if (input.amount.lte(0)) {
      if (forecast) {
        await this.reverseForecast(tx, forecast);
      }
      return;
    }

    if (forecast) {
      await tx.costForecast.update({
        where: { id: forecast.id },
        data: { amount: input.amount },
      });
      if (forecast.financialPostingId) {
        await tx.financialPosting.update({
          where: { id: forecast.financialPostingId },
          data: { amount: input.amount, isReversed: false, reversedAt: null },
        });
      }
      return;
    }

    const created = await tx.costForecast.create({
      data: {
        companyId: input.companyId,
        projectId: input.projectId,
        costCodeId: input.costCodeId,
        amount: input.amount,
        reason: ORIGINAL_FORECAST_REASON,
        period: new Date(),
        forecastDate: new Date(),
        status: ForecastStatus.ACTIVE,
        createdById: input.userId,
      },
    });
    const posting = await tx.financialPosting.create({
      data: {
        companyId: input.companyId,
        projectId: input.projectId,
        costCodeId: input.costCodeId,
        postingType: FinancialPostingType.FORECAST,
        sourceType: FinancialSourceType.FORECAST,
        sourceId: created.id,
        amount: input.amount,
        postingDate: new Date(),
      },
    });
    await tx.costForecast.update({
      where: { id: created.id },
      data: { financialPostingId: posting.id },
    });
  }

  private async dropDuplicateLumpRemaining(tx: Prisma.TransactionClient, projectId: string) {
    const remaining = await tx.costForecast.findMany({
      where: {
        projectId,
        status: ForecastStatus.ACTIVE,
        reason: { in: [...AUTO_REMAINING_FORECAST_REASONS] },
      },
      include: { costCode: { select: { code: true } } },
    });
    const hasStructured = remaining.some((row) => !isLumpCostCode(row.costCode.code));
    if (!hasStructured) {
      return;
    }
    for (const row of remaining.filter((item) => isLumpCostCode(item.costCode.code))) {
      await this.reverseForecast(tx, row);
    }
  }

  private async reverseForecast(
    tx: Prisma.TransactionClient,
    forecast: { id: string; financialPostingId: string | null },
  ) {
    if (forecast.financialPostingId) {
      await tx.financialPosting.update({
        where: { id: forecast.financialPostingId },
        data: { isReversed: true, reversedAt: new Date() },
      });
    }
    await tx.costForecast.update({
      where: { id: forecast.id },
      data: { amount: zero(), status: ForecastStatus.SUPERSEDED },
    });
  }

  private async seedOriginalContract(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      project: { id: string; name: string; contractNo: string | null; contractStartDate: Date | null };
      originalValue: Prisma.Decimal;
      contractNo?: string;
    },
  ) {
    const contractNo =
      input.contractNo ??
      input.project.contractNo ??
      (await this.sequences.next(input.companyId, EntityType.CONTRACT, tx, 'CON'));
    const created = await tx.contract.create({
      data: {
        companyId: input.companyId,
        projectId: input.project.id,
        contractNo,
        title: `${input.project.name} original contract`,
        originalValue: input.originalValue,
        revisedValue: input.originalValue,
        startDate: input.project.contractStartDate ?? undefined,
      },
    });
    await tx.revenuePosting.create({
      data: {
        companyId: input.companyId,
        projectId: input.project.id,
        contractId: created.id,
        postingType: RevenuePostingType.CONTRACT_BASE,
        amount: input.originalValue,
        postingDate: created.startDate ?? new Date(),
      },
    });
    await tx.contractRevision.create({
      data: {
        projectId: input.project.id,
        contractId: created.id,
        previousValue: zero(),
        newValue: input.originalValue,
        reason: 'Original contract baseline recorded',
        createdById: input.userId,
      },
    });
  }

  private async seedOriginalCosts(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      userId: string;
      projectId: string;
      lines: Array<{ code: string; name: string; category: CostCategory; amount: Prisma.Decimal }>;
    },
  ) {
    const codes: Array<{
      code: string;
      name: string;
      category: CostCategory;
      amount: Prisma.Decimal;
      costCodeId: string;
    }> = [];
    for (const line of input.lines) {
      const costCode = await tx.costCode.create({
        data: {
          companyId: input.companyId,
          projectId: input.projectId,
          code: line.code,
          name: line.name,
          category: line.category,
        },
      });
      codes.push({ ...line, costCodeId: costCode.id });
    }
    const total = codes.reduce((acc, line) => acc.plus(line.amount), zero());
    await tx.projectBudget.create({
      data: {
        companyId: input.companyId,
        projectId: input.projectId,
        originalAmount: total,
        currentAmount: total,
        approvedAt: new Date(),
        lines: {
          create: codes.map((line) => ({
            costCodeId: line.costCodeId,
            originalAmount: line.amount,
            currentAmount: line.amount,
          })),
        },
      },
    });
    for (const line of codes) {
      const forecast = await tx.costForecast.create({
        data: {
          companyId: input.companyId,
          projectId: input.projectId,
          costCodeId: line.costCodeId,
          amount: line.amount,
          reason: ORIGINAL_FORECAST_REASON,
          period: new Date(),
          forecastDate: new Date(),
          status: ForecastStatus.ACTIVE,
          createdById: input.userId,
        },
      });
      const posting = await tx.financialPosting.create({
        data: {
          companyId: input.companyId,
          projectId: input.projectId,
          costCodeId: line.costCodeId,
          postingType: FinancialPostingType.FORECAST,
          sourceType: FinancialSourceType.FORECAST,
          sourceId: forecast.id,
          amount: line.amount,
          postingDate: new Date(),
        },
      });
      await tx.costForecast.update({
        where: { id: forecast.id },
        data: { financialPostingId: posting.id },
      });
    }
  }
}
