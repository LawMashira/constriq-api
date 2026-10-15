import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EntityType } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { zero } from '../common/money';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  async getCurrent(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { settings: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async update(companyId: string, userId: string, dto: UpdateCompanyDto) {
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: dto,
      include: { settings: true },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UPDATE,
      module: 'COMPANY',
      entityType: EntityType.COMPANY,
      entityId: companyId,
      description: 'Company profile updated',
      newData: { ...dto },
    });
    return updated;
  }

  async updateSettings(companyId: string, userId: string, dto: UpdateCompanySettingsDto) {
    const updated = await this.prisma.companySetting.upsert({
      where: { companyId },
      create: { companyId, ...dto },
      update: dto,
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UPDATE,
      module: 'COMPANY',
      entityType: EntityType.COMPANY,
      entityId: companyId,
      description: 'Company settings updated',
      newData: dto as object,
    });
    return updated;
  }

  listSequences(companyId: string) {
    return this.sequences.list(companyId);
  }

  upsertSequence(
    companyId: string,
    entityType: EntityType,
    input: { prefix: string; nextNumber?: number; padding?: number },
  ) {
    return this.sequences.upsert(companyId, entityType, input);
  }

  async financials(companyId: string) {
    const health = await this.prisma.projectHealth.findMany({ where: { companyId } });
    const totals = health.reduce(
      (acc, item) => ({
        expectedProfit: acc.expectedProfit.plus(item.expectedProfit),
        forecastProfit: acc.forecastProfit.plus(item.forecastProfit),
        profitAtRisk: acc.profitAtRisk.plus(item.profitAtRisk),
        actualCost: acc.actualCost.plus(item.actualCost),
        committedCost: acc.committedCost.plus(item.committedCost),
        expectedRevenue: acc.expectedRevenue.plus(item.expectedRevenue),
        originalBudget: acc.originalBudget.plus(item.originalBudget),
        forecastFinalCost: acc.forecastFinalCost.plus(item.forecastFinalCost),
        cashFlowExposure: acc.cashFlowExposure.plus(item.cashFlowExposure),
        atRisk: acc.atRisk + (item.state === 'AT_RISK' || item.state === 'CRITICAL' ? 1 : 0),
        critical: acc.critical + (item.state === 'CRITICAL' ? 1 : 0),
      }),
      {
        expectedProfit: zero(),
        forecastProfit: zero(),
        profitAtRisk: zero(),
        actualCost: zero(),
        committedCost: zero(),
        expectedRevenue: zero(),
        originalBudget: zero(),
        forecastFinalCost: zero(),
        cashFlowExposure: zero(),
        atRisk: 0,
        critical: 0,
      },
    );
    const snapshot = await this.prisma.companyFinancialSnapshot.create({
      data: {
        companyId,
        activeProjectCount: health.length,
        totalContractValue: totals.expectedRevenue,
        revisedContractValue: totals.expectedRevenue,
        totalOriginalBudget: totals.originalBudget,
        actualCost: totals.actualCost,
        committedCost: totals.committedCost,
        forecastFinalCost: totals.forecastFinalCost,
        expectedProfit: totals.expectedProfit,
        forecastProfit: totals.forecastProfit,
        profitAtRisk: totals.profitAtRisk,
        expectedMargin: totals.expectedRevenue.isZero()
          ? zero()
          : totals.expectedProfit.div(totals.expectedRevenue).times(100).toDecimalPlaces(4),
        forecastMargin: totals.expectedRevenue.isZero()
          ? zero()
          : totals.forecastProfit.div(totals.expectedRevenue).times(100).toDecimalPlaces(4),
        atRiskProjectCount: totals.atRisk,
        criticalProjectCount: totals.critical,
        revenueOutstanding: zero(),
        cashFlowExposure: totals.cashFlowExposure,
      },
    });
    return snapshot;
  }
}
