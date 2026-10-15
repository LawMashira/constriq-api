import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CostsService } from './costs.service';
import { CreateActualCostDto } from './dto/create-actual-cost.dto';

@Controller('projects/:projectId/costs')
export class CostsController {
  constructor(private readonly costs: CostsService) {}

  @Get()
  @RequirePermissions('cost.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.costs.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('cost.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateActualCostDto,
  ) {
    return this.costs.create(user.companyId, user.id, projectId, dto);
  }
}
