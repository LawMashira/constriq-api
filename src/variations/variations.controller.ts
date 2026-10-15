import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { VariationStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateVariationDto } from './dto/create-variation.dto';
import { VariationsService } from './variations.service';

class TransitionVariationDto {
  @IsEnum(VariationStatus)
  status: VariationStatus;
}

@Controller('projects/:projectId/variations')
export class VariationsController {
  constructor(private readonly variations: VariationsService) {}

  @Get()
  @RequirePermissions('variation.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.variations.list(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions('variation.create')
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateVariationDto,
  ) {
    return this.variations.create(user.companyId, user.id, projectId, dto);
  }

  @Post(':variationId/transition')
  transition(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('variationId') variationId: string,
    @Body() dto: TransitionVariationDto,
  ) {
    return this.variations.transition(
      user.companyId,
      user.id,
      user.permissions,
      projectId,
      variationId,
      dto.status,
    );
  }
}
