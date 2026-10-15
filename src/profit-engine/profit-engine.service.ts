import { Injectable } from '@nestjs/common';
import {
  FinancialPostingType,
  HealthState,
  LeakageSeverity,
  LeakageStatus,
  LeakageType,
  NotificationStatus,
  NotificationType,
  Prisma,
  RevenuePostingType,
  SystemRole,
  UserStatus,
} from '@prisma/client';
import { money, sum, zero } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { calculateProfit } from './profit-formulas';
import { explainCostOverruns } from './profit-explanations';

@Injectable()
export class ProfitEngineService {
  constructor(private readonly prisma: PrismaService) {}

  private inflight = new Map<string, Promise<unknown>>();

  async recalculate(companyId: string, projectId: string) {
    const key = `${companyId}:${projectId}`;
    const pending = this.inflight.get(key);
    if (pending) {
      return pending as ReturnType<ProfitEngineService['runRecalculate']>;
    }
    const run = this.runRecalculate(companyId, projectId).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  private async runRecalculate(companyId: string, projectId: string) {
    const snapshot = await this.compute(companyId, projectId);
    const state = healthState(snapshot.profitAtRisk, snapshot.expectedProfit);
    const reasons = await this.syncLeakage(companyId, projectId, snapshot);

    const payload = {
      companyId,
      state,
      explanation: reasons.map((item) => item.title).join('; ') || 'No material threats',
      expectedRevenue: snapshot.expectedRevenue,
      originalBudget: snapshot.originalBudget,
      currentBudget: snapshot.currentBudget,
      actualCost: snapshot.actualCost,
      committedCost: snapshot.openCommittedCost,
      forecastToComplete: snapshot.forecastUncommittedCost,
      forecastFinalCost: snapshot.forecastFinalCost,
      expectedProfit: snapshot.expectedProfit,
      forecastProfit: snapshot.forecastProfit,
      profitAtRisk: snapshot.profitAtRisk,
      originalMargin: percentField(marginOrZero(snapshot.expectedProfit, snapshot.expectedRevenue)),
      expectedMargin: percentField(marginOrZero(snapshot.expectedProfit, snapshot.expectedRevenue)),
      forecastMargin: percentField(snapshot.forecastMargin ?? zero()),
      currentMargin: percentField(marginOrZero(snapshot.forecastProfit, snapshot.expectedRevenue)),
      marginDeterioration: percentField(
        marginOrZero(snapshot.expectedProfit, snapshot.expectedRevenue).minus(
          marginOrZero(snapshot.forecastProfit, snapshot.expectedRevenue),
        ),
      ),
      approvedVariations: snapshot.qualifyingVariationRevenue,
      certifiedRevenue: snapshot.certifiedRevenue,
      paidRevenue: snapshot.cashReceived,
      outstandingRevenue: money(snapshot.certifiedRevenue).minus(snapshot.cashReceived),
      unallocatedCost: snapshot.unallocatedCost,
      unapprovedVariationExposure: snapshot.unapprovedVariationExposure,
    };

    const health = await this.prisma.projectHealth.upsert({
      where: { projectId },
      create: { projectId, ...payload },
      update: payload,
    });

    await this.prisma.projectHealthSnapshot.create({
      data: {
        projectId,
        state: health.state,
        explanation: health.explanation,
        expectedRevenue: health.expectedRevenue,
        originalBudget: health.originalBudget,
        currentBudget: health.currentBudget,
        actualCost: health.actualCost,
        committedCost: health.committedCost,
        forecastToComplete: health.forecastToComplete,
        forecastFinalCost: health.forecastFinalCost,
        expectedProfit: health.expectedProfit,
        forecastProfit: health.forecastProfit,
        profitAtRisk: health.profitAtRisk,
        originalMargin: health.originalMargin,
        expectedMargin: health.expectedMargin,
        forecastMargin: health.forecastMargin,
        currentMargin: health.currentMargin,
        marginDeterioration: health.marginDeterioration,
        approvedVariations: health.approvedVariations,
        certifiedRevenue: health.certifiedRevenue,
        paidRevenue: health.paidRevenue,
        outstandingRevenue: health.outstandingRevenue,
        cashFlowExposure: health.cashFlowExposure,
      },
    });

    return {
      ...snapshot,
      status: state,
      leakage: reasons,
      reasons: reasons.map((item) => ({
        type: item.leakageType,
        amount: item.financialImpact,
        description: `${item.title}. ${item.description}`,
        recommendedAction: item.recommendedAction,
      })),
    };
  }

  async compute(companyId: string, projectId: string) {
    const [contracts, variations, budget, postings, costCodes, unallocated, submittedVars, certifications, payments] =
      await Promise.all([
        this.prisma.contract.findMany({ where: { projectId, companyId } }),
        this.prisma.revenuePosting.findMany({
          where: {
            projectId,
            companyId,
            postingType: {
              in: [RevenuePostingType.APPROVED_VARIATION, RevenuePostingType.EXECUTED_VARIATION],
            },
          },
        }),
        this.prisma.projectBudget.findUnique({
          where: { projectId },
          include: { lines: true },
        }),
        this.prisma.financialPosting.findMany({
          where: { projectId, companyId, isReversed: false },
        }),
        this.prisma.costCode.findMany({ where: { projectId } }),
        this.prisma.actualCost.aggregate({
          where: { companyId, projectId, isUnallocated: true },
          _sum: { amount: true },
        }),
        this.prisma.variation.aggregate({
          where: { projectId, companyId, status: { in: ['DRAFT', 'SUBMITTED'] } },
          _sum: { sellingPrice: true },
        }),
        this.prisma.certification.aggregate({
          where: { projectId },
          _sum: { certifiedAmount: true },
        }),
        this.prisma.payment.aggregate({
          where: { projectId, certificationId: { not: null } },
          _sum: { amount: true },
        }),
      ]);

    const originalContractValue = sum(contracts.map((item) => item.originalValue));
    const qualifyingVariationRevenue = sum(variations.map((item) => item.amount));
    const actualCost = sum(
      postings.filter((item) => item.postingType === FinancialPostingType.ACTUAL).map((item) => item.amount),
    );
    const openCommittedCost = sum(
      postings
        .filter((item) => item.postingType === FinancialPostingType.COMMITMENT)
        .map((item) => item.amount),
    );
    const forecastUncommittedCost = sum(
      postings
        .filter((item) => item.postingType === FinancialPostingType.FORECAST)
        .map((item) => item.amount),
    );

    const profit = calculateProfit({
      originalContractValue,
      qualifyingVariationRevenue,
      originalCostBudget: budget?.originalAmount ?? zero(),
      currentCostBudget: budget?.currentAmount ?? zero(),
      actualCost,
      openCommittedCost,
      forecastUncommittedCost,
      certifiedRevenue: certifications._sum.certifiedAmount ?? zero(),
      cashReceived: payments._sum.amount ?? zero(),
    });

    return {
      ...profit,
      qualifyingVariationRevenue,
      unallocatedCost: money(unallocated._sum.amount ?? 0),
      unapprovedVariationExposure: money(submittedVars._sum.sellingPrice ?? 0),
      contributors: this.contributors(postings, profit.profitAtRisk),
      costDrivers: explainCostOverruns({
        profitAtRisk: profit.profitAtRisk,
        budgetLines: budget?.lines ?? [],
        postings,
        costCodes,
      }),
    };
  }

  private contributors(
    postings: Array<{ postingType: FinancialPostingType; amount: Prisma.Decimal; costCodeId: string | null }>,
    profitAtRisk: Prisma.Decimal,
  ) {
    if (profitAtRisk.lte(0)) {
      return [];
    }
    const byType = new Map<string, Prisma.Decimal>();
    for (const posting of postings) {
      const key = posting.postingType;
      byType.set(key, money(byType.get(key) ?? 0).plus(posting.amount));
    }
    return [...byType.entries()].map(([category, amount]) => ({ category, amount }));
  }

  private async syncLeakage(
    companyId: string,
    projectId: string,
    snapshot: Awaited<ReturnType<ProfitEngineService['compute']>>,
  ) {
    await this.prisma.leakageFinding.updateMany({
      where: { projectId, companyId, status: LeakageStatus.OPEN },
      data: { status: LeakageStatus.RESOLVED, resolvedAt: new Date() },
    });

    const findings: Prisma.LeakageFindingCreateManyInput[] = [];
    if (snapshot.profitAtRisk.gt(0) && snapshot.costDrivers.length) {
      for (const driver of snapshot.costDrivers) {
        findings.push({
          companyId,
          projectId,
          costCodeId: driver.costCodeId,
          leakageType: driver.leakageType,
          sourceType: driver.costCodeId ? 'COST_CODE' : 'PROJECT',
          sourceId: driver.costCodeId ?? projectId,
          title: driver.title,
          description: driver.description,
          financialImpact: driver.amount,
          severity: driver.amount.gte(snapshot.expectedProfit.times(0.5))
            ? LeakageSeverity.CRITICAL
            : driver.amount.gte(snapshot.expectedProfit.times(0.25))
              ? LeakageSeverity.HIGH
              : LeakageSeverity.MEDIUM,
          recommendedAction: driver.action,
        });
      }
    } else if (snapshot.profitAtRisk.gt(0)) {
      findings.push({
        companyId,
        projectId,
        leakageType: LeakageType.MARGIN_DETERIORATION,
        sourceType: 'PROJECT',
        sourceId: projectId,
        title: 'Profit is below what we expected',
        description: `Forecast profit is R ${snapshot.forecastProfit.toFixed(2)}, R ${snapshot.profitAtRisk.toFixed(2)} below the expected R ${snapshot.expectedProfit.toFixed(2)}.`,
        financialImpact: snapshot.profitAtRisk,
        severity: snapshot.profitAtRisk.gte(snapshot.expectedProfit.times(0.5))
          ? LeakageSeverity.CRITICAL
          : LeakageSeverity.HIGH,
        recommendedAction: 'Open Actual costs, Labour, Plant and Procurement to see what was posted.',
      });
    }
    if (snapshot.currentBudget.gt(0) && snapshot.actualCost.plus(snapshot.openCommittedCost).gt(snapshot.currentBudget)) {
      findings.push({
        companyId,
        projectId,
        leakageType: LeakageType.COMMITTED_EXPOSURE,
        sourceType: 'PROJECT',
        sourceId: projectId,
        title: 'Commitment exceeds remaining budget',
        description: 'Actual plus open commitment is above current budget',
        financialImpact: snapshot.actualCost.plus(snapshot.openCommittedCost).minus(snapshot.currentBudget),
        severity: LeakageSeverity.HIGH,
        recommendedAction: 'Stop unapproved commitments and revise forecast',
      });
    }
    if (snapshot.unallocatedCost.gt(0)) {
      findings.push({
        companyId,
        projectId,
        leakageType: LeakageType.UNALLOCATED_COST,
        sourceType: 'PROJECT',
        sourceId: projectId,
        title: 'Unallocated cost',
        description: `R ${snapshot.unallocatedCost.toFixed(2)} of cost has no cost code.`,
        financialImpact: snapshot.unallocatedCost,
        severity: LeakageSeverity.MEDIUM,
        recommendedAction: 'Open Actual costs and assign a cost code.',
      });
    }
    if (snapshot.unapprovedVariationExposure.gt(0)) {
      findings.push({
        companyId,
        projectId,
        leakageType: LeakageType.UNRECOVERED_VARIATION,
        sourceType: 'PROJECT',
        sourceId: projectId,
        title: 'Unrecovered variation',
        description: 'Submitted or draft variations are not revenue',
        financialImpact: snapshot.unapprovedVariationExposure,
        severity: LeakageSeverity.MEDIUM,
        recommendedAction: 'Pursue client approval or reverse the cost exposure',
      });
    }

    if (findings.length) {
      await this.prisma.leakageFinding.createMany({ data: findings });
    }

    const open = await this.prisma.leakageFinding.findMany({
      where: { projectId, companyId, status: LeakageStatus.OPEN },
      orderBy: { financialImpact: 'desc' },
    });
    await this.notifyLeakage(companyId, projectId, healthState(snapshot.profitAtRisk, snapshot.expectedProfit), open);
    return open;
  }

  async cashFlow(companyId: string, projectId: string, horizonDays = 90) {
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
    const [certifications, invoices, stored] = await Promise.all([
      this.prisma.certification.findMany({ where: { projectId } }),
      this.prisma.supplierInvoice.findMany({
        where: { projectId, companyId, paymentStatus: { not: 'PAID' } },
      }),
      this.prisma.cashFlowEntry.findMany({
        where: { projectId, expectedDate: { lte: horizon } },
        orderBy: { expectedDate: 'asc' },
      }),
    ]);

    const inflows = certifications.map((item) => ({
      source: 'CERTIFIED_CLAIM',
      amount: item.certifiedAmount.minus(item.amountPaid),
      date: item.paymentDueDate ?? item.certifiedAt ?? now,
    }));
    const outflows = invoices.map((item) => ({
      source: 'SUPPLIER_PAYMENT',
      amount: item.totalAmount,
      date: item.dueDate ?? item.invoiceDate,
    }));
    const inflowTotal = inflows.reduce((total, item) => total.plus(item.amount), zero());
    const outflowTotal = outflows.reduce((total, item) => total.plus(item.amount), zero());

    return {
      horizonDays,
      inflows: inflows.map((item) => ({ ...item, amount: item.amount.toFixed(2) })),
      outflows: outflows.map((item) => ({ ...item, amount: item.amount.toFixed(2) })),
      storedEntries: stored,
      netPosition: inflowTotal.minus(outflowTotal).toFixed(2),
    };
  }

  private async notifyLeakage(
    companyId: string,
    projectId: string,
    state: HealthState,
    findings: Array<{ title: string; financialImpact: Prisma.Decimal; recommendedAction: string | null }>,
  ) {
    if (state === HealthState.HEALTHY || findings.length === 0) {
      return;
    }
    const recipients = await this.prisma.user.findMany({
      where: {
        companyId,
        status: UserStatus.ACTIVE,
        OR: [
          { managedProjects: { some: { id: projectId } } },
          {
            roles: {
              some: {
                role: {
                  systemRole: {
                    in: [
                      SystemRole.OWNER,
                      SystemRole.DIRECTOR,
                      SystemRole.MANAGING_DIRECTOR,
                      SystemRole.COMMERCIAL_MANAGER,
                      SystemRole.FINANCE_MANAGER,
                    ],
                  },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    const primary = findings[0];
    for (const user of recipients) {
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId: user.id,
          projectId,
          type: NotificationType.PROJECT_AT_RISK,
          status: { in: [NotificationStatus.PENDING, NotificationStatus.SENT] },
          createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
        },
      });
      if (existing) {
        continue;
      }
      await this.prisma.notification.create({
        data: {
          companyId,
          userId: user.id,
          projectId,
          type: NotificationType.PROJECT_AT_RISK,
          title: primary.title,
          message: `Project health is ${state}. ${primary.title}`,
          financialImpact: primary.financialImpact,
          recommendedAction: primary.recommendedAction,
          entityType: 'PROJECT',
          entityId: projectId,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }
  }
}

function healthState(profitAtRisk: Prisma.Decimal, expectedProfit: Prisma.Decimal): HealthState {
  if (profitAtRisk.lte(0)) {
    return HealthState.HEALTHY;
  }
  if (expectedProfit.gt(0) && profitAtRisk.div(expectedProfit).gte(0.5)) {
    return HealthState.CRITICAL;
  }
  if (expectedProfit.gt(0) && profitAtRisk.div(expectedProfit).gte(0.25)) {
    return HealthState.AT_RISK;
  }
  return HealthState.WATCH;
}

function marginOrZero(profit: Prisma.Decimal, revenue: Prisma.Decimal): Prisma.Decimal {
  if (revenue.isZero()) {
    return zero();
  }
  return profit.div(revenue).times(100).toDecimalPlaces(4);
}

function percentField(value: Prisma.Decimal): Prisma.Decimal {
  const scaled = new Prisma.Decimal(value).toDecimalPlaces(4);
  const max = new Prisma.Decimal('9999.9999');
  const min = new Prisma.Decimal('-9999.9999');
  if (scaled.gt(max)) {
    return max;
  }
  if (scaled.lt(min)) {
    return min;
  }
  return scaled;
}
