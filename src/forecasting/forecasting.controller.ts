import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateForecastDto, ForecastingService } from './forecasting.service';

@Controller('projects/:projectId/forecast')
export class ForecastingController {
  constructor(private readonly forecasts: ForecastingService) {}

  @Get()
  @RequirePermissions('financial_dashboard.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.forecasts.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('cost.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateForecastDto,
  ) {
    return this.forecasts.create(user.companyId, user.id, projectId, dto);
  }
}
