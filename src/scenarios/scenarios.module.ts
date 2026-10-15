import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import {
  FinancialPostingType,
  FinancialSourceType,
  ForecastStatus,
  ScenarioAdjustmentType,
  ScenarioStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { IsMoney } from '../common/dto/money-field';
import { money, subtract, zero } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';

class AdjustmentDto {
  @IsEnum(ScenarioAdjustmentType)
  adjustmentType: ScenarioAdjustmentType;

  @IsOptional()
  @IsMoney()
  revenueAdjustment?: string;

  @IsOptional()
  @IsMoney()
  costAdjustment?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsString()
  variationId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class CreateScenarioDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdjustmentDto)
  adjustments: AdjustmentDto[];
}

@Injectable()
class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly profit: ProfitEngineService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.scenario.findMany({
      where: { companyId, projectId },
      include: { adjustments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(companyId: string, projectId: string, dto: CreateScenarioDto) {
    await this.projects.getWritable(companyId, projectId);
    const base = await this.profit.compute(companyId, projectId);
    const revenueAdj = dto.adjustments.reduce(
      (total, item) => total.plus(money(item.revenueAdjustment ?? 0)),
      zero(),
    );
    const costAdj = dto.adjustments.reduce(
      (total, item) => total.plus(money(item.costAdjustment ?? 0)),
      zero(),
    );
    const expectedRevenue = money(base.expectedRevenue).plus(revenueAdj);
    const forecastFinal = money(base.forecastFinalCost).plus(costAdj);
    const expectedProfit = subtract(expectedRevenue, base.originalBudget);
    const forecastProfit = subtract(expectedRevenue, forecastFinal);
    return this.prisma.scenario.create({
      data: {
        companyId,
        projectId,
        name: dto.name,
        description: dto.description,
        status: ScenarioStatus.ACTIVE,
        projectedExpectedProfit: expectedProfit,
        projectedForecastProfit: forecastProfit,
        projectedProfitAtRisk: subtract(expectedProfit, forecastProfit),
        adjustments: {
          create: dto.adjustments.map((item) => ({
            adjustmentType: item.adjustmentType,
            revenueAdjustment: money(item.revenueAdjustment ?? 0),
            costAdjustment: money(item.costAdjustment ?? 0),
            costCodeId: item.costCodeId,
            variationId: item.variationId,
            description: item.description,
          })),
        },
      },
      include: { adjustments: true },
    });
  }

  async apply(companyId: string, userId: string, projectId: string, scenarioId: string) {
    await this.projects.getWritable(companyId, projectId);
    const scenario = await this.prisma.scenario.findFirst({
      where: { id: scenarioId, companyId, projectId },
      include: { adjustments: true },
    });
    if (!scenario) {
      throw new BadRequestException('Scenario not found');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const adjustment of scenario.adjustments) {
        if (!adjustment.costCodeId || money(adjustment.costAdjustment).isZero()) {
          continue;
        }
        const forecast = await tx.costForecast.create({
          data: {
            companyId,
            projectId,
            costCodeId: adjustment.costCodeId,
            amount: money(adjustment.costAdjustment),
            reason: `Scenario ${scenario.name}: ${adjustment.description ?? adjustment.adjustmentType}`,
            period: new Date(),
            forecastDate: new Date(),
            status: ForecastStatus.ACTIVE,
            createdById: userId,
          },
        });
        const posting = await tx.financialPosting.create({
          data: {
            companyId,
            projectId,
            costCodeId: adjustment.costCodeId,
            postingType: FinancialPostingType.FORECAST,
            sourceType: FinancialSourceType.FORECAST,
            sourceId: forecast.id,
            amount: money(adjustment.costAdjustment),
            postingDate: new Date(),
          },
        });
        await tx.costForecast.update({
          where: { id: forecast.id },
          data: { financialPostingId: posting.id },
        });
      }
      await tx.scenario.update({
        where: { id: scenario.id },
        data: { status: ScenarioStatus.APPLIED, appliedAt: new Date() },
      });
    });
    await this.profit.recalculate(companyId, projectId);
    return this.prisma.scenario.findUniqueOrThrow({
      where: { id: scenario.id },
      include: { adjustments: true },
    });
  }
}

@Controller('projects/:projectId/scenarios')
class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  @RequirePermissions('financial_dashboard.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.scenarios.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('cost.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateScenarioDto,
  ) {
    return this.scenarios.create(user.companyId, projectId, dto);
  }

  @Post(':scenarioId/apply')
  @RequirePermissions('budget.approve')
  apply(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('scenarioId') scenarioId: string,
  ) {
    return this.scenarios.apply(user.companyId, user.id, projectId, scenarioId);
  }
}

@Module({
  imports: [ProfitEngineModule],
  controllers: [ScenariosController],
  providers: [ScenariosService],
})
export class ScenariosModule {}
