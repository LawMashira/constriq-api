import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BoqService } from './boq.service';
import { CreateBoqDto } from './dto/create-boq.dto';

@Controller('projects/:projectId/boq')
export class BoqController {
  constructor(private readonly boq: BoqService) {}

  @Get()
  @RequirePermissions('budget.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.boq.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('budget.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBoqDto,
  ) {
    return this.boq.create(user.companyId, projectId, dto);
  }

  @Post('adopt-commercial')
  @RequirePermissions('budget.create')
  adoptCommercial(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.boq.adoptCommercial(user.companyId, user.id, projectId);
  }

  @Patch('items/:itemId')
  @RequirePermissions('budget.update')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() dto: Partial<{ description: string; quantity: string; rate: string; costCodeId: string }>,
  ) {
    return this.boq.updateItem(user.companyId, projectId, itemId, dto);
  }
}
