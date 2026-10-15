import { Controller, Get, Param } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { jsonMoney } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from './profit-engine.service';

@Controller('projects/:projectId')
export class ProfitEngineController {
  constructor(
    private readonly profit: ProfitEngineService,
    private readonly projects: ProjectAccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('profit')
  @RequirePermissions('financial_dashboard.read')
  async profitSnapshot(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
  ) {
    await this.projects.get(user.companyId, projectId);
    const result = await this.profit.recalculate(user.companyId, projectId);
    return serializeProfit(result);
  }

  @Get('health')
  @RequirePermissions('financial_dashboard.read')
  async health(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    await this.projects.get(user.companyId, projectId);
    const result = await this.profit.recalculate(user.companyId, projectId);
    return {
      status: result.status,
      reasons: result.reasons.map((item) => ({
        type: item.type,
        amount: jsonMoney(item.amount),
        description: item.description,
        recommendedAction: item.recommendedAction,
      })),
    };
  }

  @Get('leakage')
  @RequirePermissions('financial_dashboard.read')
  async leakage(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    await this.projects.get(user.companyId, projectId);
    await this.profit.recalculate(user.companyId, projectId);
    return this.prisma.leakageFinding.findMany({
      where: { projectId, companyId: user.companyId, status: 'OPEN' },
      orderBy: { financialImpact: 'desc' },
    });
  }

  @Get('cash-flow')
  @RequirePermissions('financial_dashboard.read')
  async cashFlow(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    await this.projects.get(user.companyId, projectId);
    return this.profit.cashFlow(user.companyId, projectId);
  }
}

function serializeProfit(result: Awaited<ReturnType<ProfitEngineService['recalculate']>>) {
  return {
    expectedRevenue: jsonMoney(result.expectedRevenue),
    expectedProfit: jsonMoney(result.expectedProfit),
    forecastFinalCost: jsonMoney(result.forecastFinalCost),
    forecastProfit: jsonMoney(result.forecastProfit),
    profitAtRisk: jsonMoney(result.profitAtRisk),
    forecastMargin: result.forecastMargin ? result.forecastMargin.toFixed(4) : null,
    originalBudget: jsonMoney(result.originalBudget),
    currentBudget: jsonMoney(result.currentBudget),
    actualCost: jsonMoney(result.actualCost),
    openCommittedCost: jsonMoney(result.openCommittedCost),
    forecastUncommittedCost: jsonMoney(result.forecastUncommittedCost),
    certifiedRevenue: jsonMoney(result.certifiedRevenue),
    paidRevenue: jsonMoney(result.cashReceived),
    outstandingRevenue: jsonMoney(result.certifiedRevenue.minus(result.cashReceived)),
    approvedVariations: jsonMoney(result.qualifyingVariationRevenue),
    unapprovedVariationExposure: jsonMoney(result.unapprovedVariationExposure),
    unallocatedCost: jsonMoney(result.unallocatedCost),
    contributors: result.contributors.map((item) => ({
      category: item.category,
      amount: jsonMoney(item.amount),
    })),
  };
}
