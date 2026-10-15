import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CostCodesService } from './cost-codes.service';
import { CreateCostCodeDto } from './dto/create-cost-code.dto';

@Controller('projects/:projectId/cost-codes')
export class CostCodesController {
  constructor(private readonly costCodes: CostCodesService) {}

  @Get()
  @RequirePermissions('cost_code.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.costCodes.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('cost_code.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateCostCodeDto,
  ) {
    return this.costCodes.create(user.companyId, projectId, dto);
  }

  @Patch(':id')
  @RequirePermissions('cost_code.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: CreateCostCodeDto,
  ) {
    return this.costCodes.update(user.companyId, projectId, id, dto);
  }

  @Post('from-template/:templateId')
  @RequirePermissions('cost_code.create')
  fromTemplate(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.costCodes.applyTemplate(user.companyId, projectId, templateId);
  }
}

@Controller('cost-code-templates')
export class CostCodeTemplatesController {
  constructor(private readonly costCodes: CostCodesService) {}

  @Get()
  @RequirePermissions('cost_code.read')
  list(@CurrentUser() user: AuthUser) {
    return this.costCodes.listTemplates(user.companyId);
  }

  @Post()
  @RequirePermissions('cost_code.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCostCodeDto) {
    return this.costCodes.createTemplate(user.companyId, dto);
  }
}
