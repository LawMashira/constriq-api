import { Injectable } from '@nestjs/common';
import { FinancialPostingType, FinancialSourceType, ForecastStatus } from '@prisma/client';
import { IsDateString, IsString } from 'class-validator';
import { IsMoney } from '../common/dto/money-field';
import { money } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';

export class CreateForecastDto {
  @IsString()
  costCodeId: string;

  @IsMoney()
  amount: string;

  @IsString()
  reason: string;

  @IsDateString()
  period: string;
}

@Injectable()
export class ForecastingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly profit: ProfitEngineService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.costForecast.findMany({
      where: { projectId, companyId, status: { in: [ForecastStatus.ACTIVE, ForecastStatus.DRAFT] } },
    });
  }

  async create(companyId: string, userId: string, projectId: string, dto: CreateForecastDto) {
    await this.projects.getWritable(companyId, projectId);
    const forecast = await this.prisma.$transaction(async (tx) => {
      const created = await tx.costForecast.create({
        data: {
          companyId,
          projectId,
          costCodeId: dto.costCodeId,
          amount: money(dto.amount),
          reason: dto.reason,
          period: new Date(dto.period),
          forecastDate: new Date(),
          status: ForecastStatus.ACTIVE,
          createdById: userId,
        },
      });
      const posting = await tx.financialPosting.create({
        data: {
          companyId,
          projectId,
          costCodeId: dto.costCodeId,
          postingType: FinancialPostingType.FORECAST,
          sourceType: FinancialSourceType.FORECAST,
          sourceId: created.id,
          amount: money(dto.amount),
          postingDate: new Date(),
        },
      });
      return tx.costForecast.update({
        where: { id: created.id },
        data: { financialPostingId: posting.id },
      });
    });
    await this.profit.recalculate(companyId, projectId);
    return forecast;
  }
}
