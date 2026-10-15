import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';

@Controller('projects/:projectId/contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermissions('contract.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.contracts.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('contract.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateContractDto,
  ) {
    return this.contracts.create(user.companyId, user.id, projectId, dto);
  }
}
