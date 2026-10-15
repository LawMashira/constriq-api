import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto, CreateBudgetRevisionDto } from './dto/budget.dto';

@Controller('projects/:projectId/budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @RequirePermissions('budget.read')
  get(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.budgets.get(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('budget.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgets.createOriginal(user.companyId, user.id, projectId, dto);
  }

  @Post('revisions')
  @RequirePermissions('budget.approve')
  revise(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBudgetRevisionDto,
  ) {
    return this.budgets.revise(user.companyId, user.id, projectId, dto);
  }
}
