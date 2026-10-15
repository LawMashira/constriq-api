import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, BudgetRevisionStatus, EntityType } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { money, sum } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { CreateBudgetDto, CreateBudgetRevisionDto } from './dto/budget.dto';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly profit: ProfitEngineService,
  ) {}

  async get(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.projectBudget.findUnique({
      where: { projectId },
      include: { lines: true, revisions: true },
    });
  }

  async createOriginal(companyId: string, userId: string, projectId: string, dto: CreateBudgetDto) {
    await this.projects.getWritable(companyId, projectId);
    const existing = await this.prisma.projectBudget.findUnique({ where: { projectId } });
    if (existing) {
      throw new BadRequestException('Original budget already exists');
    }
    const total = sum(dto.lines.map((line) => line.amount));
    const budget = await this.prisma.$transaction(async (tx) => {
      const created = await tx.projectBudget.create({
        data: {
          companyId,
          projectId,
          originalAmount: total,
          currentAmount: total,
          approvedAt: new Date(),
          lines: {
            create: dto.lines.map((line) => ({
              costCodeId: line.costCodeId,
              originalAmount: money(line.amount),
              currentAmount: money(line.amount),
            })),
          },
        },
        include: { lines: true },
      });
      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'BUDGETS',
          entityType: EntityType.BUDGET,
          entityId: created.id,
          description: 'Original budget recorded',
          newData: { originalAmount: total.toFixed(2) },
        },
        tx,
      );
      return created;
    });
    await this.profit.recalculate(companyId, projectId);
    return budget;
  }

  async revise(companyId: string, userId: string, projectId: string, dto: CreateBudgetRevisionDto) {
    await this.projects.getWritable(companyId, projectId);
    const budget = await this.prisma.projectBudget.findUnique({
      where: { projectId },
      include: { lines: true },
    });
    if (!budget) {
      throw new BadRequestException('Create the original budget first');
    }

    const newTotal = sum(dto.lines.map((line) => line.amount));
    const revision = await this.prisma.$transaction(async (tx) => {
      const created = await tx.budgetRevision.create({
        data: {
          companyId,
          projectId,
          budgetId: budget.id,
          previousAmount: budget.currentAmount,
          newAmount: newTotal,
          difference: money(newTotal).minus(budget.currentAmount),
          reason: dto.reason,
          status: BudgetRevisionStatus.APPROVED,
          submittedById: userId,
          approvedById: userId,
          approvedAt: new Date(),
          lines: {
            create: dto.lines.map((line) => {
              const current = budget.lines.find((item) => item.costCodeId === line.costCodeId);
              return {
                costCodeId: line.costCodeId,
                originalAmount: current?.originalAmount ?? money(line.amount),
                previousCurrentAmount: current?.currentAmount ?? money(0),
                newCurrentAmount: money(line.amount),
                difference: money(line.amount).minus(current?.currentAmount ?? 0),
              };
            }),
          },
        },
      });

      await tx.projectBudget.update({
        where: { id: budget.id },
        data: { currentAmount: newTotal },
      });

      for (const line of dto.lines) {
        const current = budget.lines.find((item) => item.costCodeId === line.costCodeId);
        if (current) {
          await tx.projectBudgetLine.update({
            where: { id: current.id },
            data: { currentAmount: money(line.amount) },
          });
        } else {
          await tx.projectBudgetLine.create({
            data: {
              budgetId: budget.id,
              costCodeId: line.costCodeId,
              originalAmount: money(0),
              currentAmount: money(line.amount),
            },
          });
        }
      }

      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.APPROVE,
          module: 'BUDGETS',
          entityType: EntityType.BUDGET_REVISION,
          entityId: created.id,
          description: 'Budget revision approved; original baseline preserved',
          oldData: { originalAmount: budget.originalAmount.toFixed(2), currentAmount: budget.currentAmount.toFixed(2) },
          newData: { originalAmount: budget.originalAmount.toFixed(2), currentAmount: newTotal.toFixed(2) },
        },
        tx,
      );
      return created;
    });

    await this.profit.recalculate(companyId, projectId);
    return revision;
  }
}
