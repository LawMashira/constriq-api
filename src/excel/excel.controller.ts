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
import { ImportType } from '@prisma/client';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ExcelService } from './excel.service';
import type { ColumnMap } from './import-fields';

class MapImportDto {
  @IsObject()
  columnMap: ColumnMap;

  @IsOptional()
  @IsBoolean()
  createMissingCostCodes?: boolean;

  @IsOptional()
  @IsBoolean()
  createMissingSuppliers?: boolean;
}

@Controller()
export class ExcelController {
  constructor(private readonly excel: ExcelService) {}

  @Get('imports/fields')
  @RequirePermissions('reports.read')
  fields(@Query('type') type: ImportType) {
    return this.excel.catalog(type ?? ImportType.BOQ);
  }

  @Get('imports/template')
  @RequirePermissions('reports.read')
  async template(@Query('type') type: ImportType, @Res() response: Response) {
    const buffer = await this.excel.template(type ?? ImportType.BOQ);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${type ?? 'BOQ'}-template.xlsx"`,
    );
    response.send(buffer);
  }

  @Get('projects/:projectId/exports/xlsx')
  @RequirePermissions('reports.read')
  async exportProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    const buffer = await this.excel.exportProject(user.companyId, projectId);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', `attachment; filename="project-${projectId}.xlsx"`);
    response.send(buffer);
  }

  @Get('projects/:projectId/imports')
  @RequirePermissions('reports.read')
  list(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.excel.list(user.companyId, projectId);
  }

  @Post('projects/:projectId/imports')
  @RequirePermissions('reports.read')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('type') type: ImportType,
    @Query('sheet') sheet: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.excel.upload({
      companyId: user.companyId,
      userId: user.id,
      projectId,
      type: type ?? ImportType.BOQ,
      file: {
        originalname: file.originalname,
        buffer: file.buffer,
        size: file.size,
        mimetype: file.mimetype,
      },
      sheetName: sheet,
    });
  }

  @Get('imports/:id')
  @RequirePermissions('reports.read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.excel.get(user.companyId, id);
  }

  @Patch('imports/:id/mapping')
  @RequirePermissions('reports.read')
  map(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MapImportDto) {
    return this.excel.map(user.companyId, user.id, id, dto.columnMap, {
      createMissingCostCodes: dto.createMissingCostCodes,
      createMissingSuppliers: dto.createMissingSuppliers,
    });
  }

  @Post('imports/:id/commit')
  @RequirePermissions('reports.read')
  commit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.excel.commit(user.companyId, user.id, id);
  }
}
