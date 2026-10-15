import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApprovalEntityType,
  ApprovalStatus,
  DocumentKind,
  EntityType,
  GeneratedReportType,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { IsMoney } from '../common/dto/money-field';
import { ManagementService } from './management.service';

class UploadMetaDto {
  @IsEnum(EntityType)
  entityType: EntityType;

  @IsString()
  entityId: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsEnum(DocumentKind)
  kind?: DocumentKind;

  @IsOptional()
  @IsString()
  name?: string;
}

class CreateApprovalDto {
  @IsEnum(ApprovalEntityType)
  entityType: ApprovalEntityType;

  @IsString()
  entityId: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsMoney()
  amount?: string;

  @IsOptional()
  @IsString()
  comments?: string;
}

class CreateApprovalRuleDto {
  @IsEnum(ApprovalEntityType)
  entityType: ApprovalEntityType;

  @IsMoney()
  minAmount: string;

  @IsOptional()
  @IsMoney()
  maxAmount?: string;

  @IsString()
  roleId: string;
}

class DecideDto {
  @IsEnum(ApprovalStatus)
  status: ApprovalStatus;

  @IsOptional()
  @IsString()
  comments?: string;
}

@Controller()
export class ManagementController {
  constructor(private readonly management: ManagementService) {}

  @Get('notifications')
  listNotifications(@CurrentUser() user: AuthUser) {
    return this.management.notifications(user);
  }

  @Patch('notifications/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.management.markRead(user, id);
  }

  @Get('documents')
  @RequirePermissions('document.read')
  documents(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.management.listDocuments(user.companyId, projectId);
  }

  @Post('documents')
  @RequirePermissions('document.create')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMetaDto,
  ) {
    return this.management.uploadDocument(user, file, dto);
  }

  @Get('documents/:id/file')
  @RequirePermissions('document.read')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const { document, buffer } = await this.management.readDocument(user.companyId, id);
    response.setHeader('Content-Type', document.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${document.fileName}"`);
    response.send(buffer);
  }

  @Get('approval-rules')
  @RequirePermissions('company.settings')
  rules(@CurrentUser() user: AuthUser) {
    return this.management.listApprovalRules(user.companyId);
  }

  @Post('approval-rules')
  @RequirePermissions('company.settings')
  createRule(@CurrentUser() user: AuthUser, @Body() dto: CreateApprovalRuleDto) {
    return this.management.createApprovalRule(user.companyId, dto);
  }

  @Get('approvals')
  listApprovals(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.management.listApprovals(user.companyId, projectId);
  }

  @Post('approvals')
  requestApproval(@CurrentUser() user: AuthUser, @Body() dto: CreateApprovalDto) {
    return this.management.requestApproval(user, dto);
  }

  @Post('approvals/:id/decide')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.management.decide(user, id, dto.status, dto.comments);
  }

  @Get('audit-logs')
  @RequirePermissions('audit.read')
  audit(@CurrentUser() user: AuthUser) {
    return this.management.listAudit(user.companyId);
  }
}

@Controller('projects/:projectId/reports')
export class ReportsController {
  constructor(private readonly management: ManagementService) {}

  @Get(':type')
  @RequirePermissions('reports.read')
  report(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('type') type: string,
  ) {
    const reportType = (type.toUpperCase().replace(/-/g, '_') || 'PROFITABILITY') as GeneratedReportType;
    return this.management.report(user.companyId, projectId, reportType);
  }
}
