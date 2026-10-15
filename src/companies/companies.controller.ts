import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { EntityType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

class UpsertSequenceDto {
  @IsEnum(EntityType)
  entityType: EntityType;

  @IsString()
  prefix: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  padding?: number;
}

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get('current')
  getCurrent(@CurrentUser() user: AuthUser) {
    return this.companies.getCurrent(user.companyId);
  }

  @Get('current/financials')
  @RequirePermissions('financial_dashboard.read')
  financials(@CurrentUser() user: AuthUser) {
    return this.companies.financials(user.companyId);
  }

  @Get('current/sequences')
  @RequirePermissions('company.settings')
  listSequences(@CurrentUser() user: AuthUser) {
    return this.companies.listSequences(user.companyId);
  }

  @Post('current/sequences')
  @RequirePermissions('company.settings')
  upsertSequence(@CurrentUser() user: AuthUser, @Body() dto: UpsertSequenceDto) {
    return this.companies.upsertSequence(user.companyId, dto.entityType, dto);
  }

  @Patch('current')
  @RequirePermissions('company.settings')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(user.companyId, user.id, dto);
  }

  @Patch('current/settings')
  @RequirePermissions('company.settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateCompanySettingsDto) {
    return this.companies.updateSettings(user.companyId, user.id, dto);
  }
}
