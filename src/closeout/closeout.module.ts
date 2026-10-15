import { Body, Controller, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import {
  AuditAction,
  CloseoutStatus,
  EntityType,
  ProjectStatus,
} from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuditService } from '../common/audit.service';
import { money, percentRatio, zero } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';

class CloseoutDto {
  @IsOptional()
  @IsString()
  lessonsLearned?: string;
}

@Injectable()
class CloseoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly profit: ProfitEngineService,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.projectCloseout.findUnique({ where: { projectId } });
  }

  async listRates(companyId: string, projectId?: string) {
    return this.prisma.historicalCostRate.findMany({
      where: { companyId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listOutcomes(companyId: string) {
    return this.prisma.historicalProjectOutcome.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async close(companyId: string, userId: string, projectId: string, dto: CloseoutDto) {
    const project = await this.projects.getWritable(companyId, projectId);
    const snapshot = await this.profit.recalculate(companyId, projectId);
    const leakages = await this.prisma.leakageFinding.findMany({
      where: { projectId, companyId },
      orderBy: { financialImpact: 'desc' },
      take: 20,
    });
    const closeout = await this.prisma.$transaction(async (tx) => {
      const record = await tx.projectCloseout.upsert({
        where: { projectId },
        create: {
          projectId,
          status: CloseoutStatus.CLOSED,
          finalContractValue: snapshot.expectedRevenue,
          finalRevenue: snapshot.expectedRevenue,
          finalCost: snapshot.forecastFinalCost,
          finalProfit: snapshot.forecastProfit,
          finalMargin: snapshot.forecastMargin ?? zero(),
          originalExpectedProfit: snapshot.expectedProfit,
          profitAtRisk: snapshot.profitAtRisk,
          outstandingCommitments: snapshot.openCommittedCost,
          lessonsLearned: dto.lessonsLearned,
          majorLeakageSummary: leakages.map((item) => ({
            type: item.leakageType,
            amount: item.financialImpact.toFixed(2),
            title: item.title,
          })),
          closedAt: new Date(),
          closedById: userId,
        },
        update: {
          status: CloseoutStatus.CLOSED,
          finalContractValue: snapshot.expectedRevenue,
          finalRevenue: snapshot.expectedRevenue,
          finalCost: snapshot.forecastFinalCost,
          finalProfit: snapshot.forecastProfit,
          finalMargin: snapshot.forecastMargin ?? zero(),
          originalExpectedProfit: snapshot.expectedProfit,
          profitAtRisk: snapshot.profitAtRisk,
          outstandingCommitments: snapshot.openCommittedCost,
          lessonsLearned: dto.lessonsLearned,
          closedAt: new Date(),
          closedById: userId,
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.CLOSED, actualCompletionDate: new Date() },
      });
      const codes = await tx.costCode.findMany({
        where: { projectId, companyId },
        include: { budgetLines: true, actualCosts: true },
      });
      for (const code of codes) {
        const estimated = code.budgetLines[0]?.originalAmount;
        const actual = code.actualCosts.reduce((total, item) => total.plus(item.amount), zero());
        await tx.historicalCostRate.create({
          data: {
            companyId,
            projectId,
            costCode: code.code,
            category: code.category,
            estimatedRate: estimated,
            actualRate: actual,
            variance: estimated ? money(actual).minus(estimated) : actual,
          },
        });
      }
      const overrun = money(snapshot.forecastFinalCost).minus(snapshot.originalBudget);
      await tx.historicalProjectOutcome.upsert({
        where: { projectId },
        create: {
          companyId,
          projectId,
          originalMargin: percentRatio(snapshot.expectedProfit, snapshot.expectedRevenue),
          finalMargin: snapshot.forecastMargin,
          costOverrun: overrun,
          frequentLeakageTypes: leakages.map((item) => item.leakageType),
        },
        update: {
          originalMargin: percentRatio(snapshot.expectedProfit, snapshot.expectedRevenue),
          finalMargin: snapshot.forecastMargin,
          costOverrun: overrun,
          frequentLeakageTypes: leakages.map((item) => item.leakageType),
        },
      });
      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.LOCK,
          module: 'CLOSEOUT',
          entityType: EntityType.CLOSEOUT,
          entityId: record.id,
          description: `Project ${project.code} closed`,
        },
        tx,
      );
      return record;
    });
    return closeout;
  }

  async reopen(companyId: string, userId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    await this.prisma.$transaction([
      this.prisma.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.ACTIVE },
      }),
      this.prisma.projectCloseout.updateMany({
        where: { projectId },
        data: { status: CloseoutStatus.REOPENED },
      }),
    ]);
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UNLOCK,
      module: 'CLOSEOUT',
      entityType: EntityType.PROJECT,
      entityId: projectId,
      description: 'Project reopened after closeout',
    });
    return { status: ProjectStatus.ACTIVE };
  }
}

@Controller('projects/:projectId/closeout')
class CloseoutController {
  constructor(private readonly closeout: CloseoutService) {}

  @Get()
  @RequirePermissions('project.read')
  get(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.closeout.get(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('project.update')
  close(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CloseoutDto,
  ) {
    return this.closeout.close(user.companyId, user.id, projectId, dto);
  }

  @Post('reopen')
  @RequirePermissions('company.settings')
  reopen(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.closeout.reopen(user.companyId, user.id, projectId);
  }
}

@Controller('history')
class HistoryController {
  constructor(private readonly closeout: CloseoutService) {}

  @Get('cost-rates')
  @RequirePermissions('reports.read')
  rates(@CurrentUser() user: AuthUser) {
    return this.closeout.listRates(user.companyId);
  }

  @Get('outcomes')
  @RequirePermissions('reports.read')
  outcomes(@CurrentUser() user: AuthUser) {
    return this.closeout.listOutcomes(user.companyId);
  }
}

@Module({
  imports: [ProfitEngineModule],
  controllers: [CloseoutController, HistoryController],
  providers: [CloseoutService],
})
export class CloseoutModule {}
