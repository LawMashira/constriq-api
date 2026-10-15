import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
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
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { resolveExpectedCostLines } from './no-boq-baseline';

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
    const expectedMargin = percentRatio(snapshot.expectedProfit, snapshot.expectedRevenue);
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
    await this.get(companyId, id);
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        contractStartDate: dto.contractStartDate ? new Date(dto.contractStartDate) : undefined,
        plannedCompletionDate: dto.plannedCompletionDate
          ? new Date(dto.plannedCompletionDate)
          : undefined,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UPDATE,
      module: 'PROJECTS',
      entityType: EntityType.PROJECT,
      entityId: id,
      description: 'Project updated',
      newData: dto as object,
    });
    return project;
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
      lines: Array<{ code: string; name: string; category: import('@prisma/client').CostCategory; amount: Prisma.Decimal }>;
    },
  ) {
    const codes = [];
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
          reason: 'Uncommitted remaining cost from the original estimate',
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
