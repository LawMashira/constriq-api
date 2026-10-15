import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsObject, IsOptional } from 'class-validator';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { ColumnMap } from '../excel/import-fields';
import { applyColumnMap, parseCsv, validateMappedRows } from '../excel/mapping';
import { parseWorkbook } from '../excel/parse-workbook';
import { ReconciliationService } from './reconciliation.service';

class ReconcileDto {
  @Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
  @IsObject()
  columnMap: ColumnMap;

  @IsOptional()
  sheet?: string;
}

@Controller('projects/:projectId/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  @RequirePermissions('reports.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.reconciliation.list(user.companyId, projectId);
  }

  @Post('accounting-costs')
  @RequirePermissions('cost.read')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async accountingCosts(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ReconcileDto,
  ) {
    const sheet = file.originalname.toLowerCase().endsWith('.csv')
      ? parseCsv(file.buffer.toString('utf8'))
      : await parseWorkbook(file.buffer, file.originalname, dto.sheet);
    const mapped = applyColumnMap(sheet, ImportType.COST, dto.columnMap);
    const { errors, valid } = validateMappedRows(ImportType.COST, mapped);
    if (errors.length) {
      return { matched: false, errors };
    }
    return this.reconciliation.compareAccountingCosts(user.companyId, projectId, valid);
  }
}
