import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, EntityType, ImportStatus, ImportType, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { FileStorageService } from '../storage/file-storage.service';
import { applyImportRows } from './apply-import';
import { fieldsFor, suggestColumnMap, type ColumnMap } from './import-fields';
import { applyColumnMap, sanitizeColumnMap, validateMappedRows, type ParsedSheet } from './mapping';
import { parseWorkbook } from './parse-workbook';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = ['.xlsx', '.xlsm', '.csv'];

@Injectable()
export class ExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly storage: FileStorageService,
    private readonly audit: AuditService,
    private readonly profit: ProfitEngineService,
  ) {}

  catalog(type: ImportType) {
    return {
      type,
      fields: fieldsFor(type).map((field) => ({
        key: field.key,
        label: field.label,
        required: field.required,
        type: field.type,
        aliases: field.aliases,
        enumValues: field.enumValues,
      })),
      mappingHelp:
        'Map any spreadsheet column onto any CONSTRIQ field using the header name, a column letter (A, B, C), or a 0-based index.',
    };
  }

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.dataImport.findMany({
      where: { companyId, projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, id: string) {
    const record = await this.prisma.dataImport.findFirst({ where: { id, companyId } });
    if (!record) {
      throw new NotFoundException('Import not found');
    }
    return record;
  }

  async upload(input: {
    companyId: string;
    userId: string;
    projectId: string;
    type: ImportType;
    file: { originalname: string; buffer: Buffer; size: number; mimetype: string };
    sheetName?: string;
  }) {
    await this.projects.getWritable(input.companyId, input.projectId);
    this.assertFile(input.file);
    const sheet = await parseWorkbook(input.file.buffer, input.file.originalname, input.sheetName);
    const suggestedMap = sanitizeColumnMap(
      sheet.headers,
      input.type,
      suggestColumnMap(sheet.headers, input.type),
    );
    const created = await this.prisma.dataImport.create({
      data: {
        companyId: input.companyId,
        projectId: input.projectId,
        type: input.type,
        status: ImportStatus.MAPPING,
        fileName: input.file.originalname,
        storageKey: 'pending',
        importedById: input.userId,
        columnMap: suggestedMap as Prisma.InputJsonValue,
        preview: {
          sheetName: sheet.sheetName,
          headers: sheet.headers,
          sample: sheet.rows.slice(0, 25),
          rowCount: sheet.rows.length,
          suggestedMap,
        } as Prisma.InputJsonValue,
      },
    });
    const storageKey = await this.storage.saveImportFile(
      input.companyId,
      created.id,
      input.file.originalname,
      input.file.buffer,
    );
    await this.storage.saveJson(`imports/${input.companyId}/${created.id}`, 'sheet.json', sheet);
    const record = await this.prisma.dataImport.update({
      where: { id: created.id },
      data: { storageKey },
    });
    await this.audit.record({
      companyId: input.companyId,
      userId: input.userId,
      action: AuditAction.IMPORT,
      module: 'EXCEL',
      entityType: EntityType.IMPORT,
      entityId: created.id,
      description: `Uploaded ${input.file.originalname} for ${input.type}`,
    });
    return {
      ...record,
      fields: this.catalog(input.type).fields,
      mappingHelp: this.catalog(input.type).mappingHelp,
    };
  }

  async map(
    companyId: string,
    userId: string,
    id: string,
    columnMap: ColumnMap,
    options?: { createMissingCostCodes?: boolean; createMissingSuppliers?: boolean },
  ) {
    const record = await this.get(companyId, id);
    if (record.status === ImportStatus.IMPORTED) {
      throw new BadRequestException('This import has already been committed');
    }
    const sheet = await this.storage.readJson<ParsedSheet>(
      `imports/${companyId}/${id}/sheet.json`,
    );
    const cleaned = sanitizeColumnMap(sheet.headers, record.type, columnMap);
    const mapped = applyColumnMap(sheet, record.type, cleaned);
    const { errors, valid } = validateMappedRows(record.type, mapped);
    const extraErrors = this.domainErrors(record.type, valid);
    const blocked = new Set(extraErrors.map((item) => item.rowNumber));
    const accepted = valid.filter((row) => !blocked.has(row.rowNumber));
    const allErrors = [...errors, ...extraErrors];
    const preview = {
      sheetName: sheet.sheetName,
      headers: sheet.headers,
      sample: accepted.slice(0, 25).map((row) => ({
        rowNumber: row.rowNumber,
        values: row.values,
        extras: row.extras,
      })),
      rowCount: sheet.rows.length,
      validCount: accepted.length,
      options: options ?? {},
    };
    const updated = await this.prisma.dataImport.update({
      where: { id },
      data: {
        status: allErrors.length ? ImportStatus.VALIDATING : ImportStatus.PREVIEW,
        columnMap: cleaned as Prisma.InputJsonValue,
        preview: preview as Prisma.InputJsonValue,
        errors: allErrors as Prisma.InputJsonValue,
        errorCount: allErrors.length,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UPDATE,
      module: 'EXCEL',
      entityType: EntityType.IMPORT,
      entityId: id,
      description: 'Column mapping saved',
      newData: columnMap,
    });
    return updated;
  }

  async commit(companyId: string, userId: string, id: string) {
    const record = await this.get(companyId, id);
    if (!record.projectId) {
      throw new BadRequestException('Import is not linked to a project');
    }
    await this.projects.getWritable(companyId, record.projectId);
    if (record.status === ImportStatus.IMPORTED) {
      throw new BadRequestException('This import has already been committed');
    }
    if (record.errorCount > 0 || record.status !== ImportStatus.PREVIEW) {
      throw new BadRequestException('Fix mapping errors and save a clean preview before importing');
    }
    const sheet = await this.storage.readJson<ParsedSheet>(
      `imports/${companyId}/${id}/sheet.json`,
    );
    const columnMap = (record.columnMap ?? {}) as ColumnMap;
    const mapped = applyColumnMap(sheet, record.type, columnMap);
    const { errors, valid } = validateMappedRows(record.type, mapped);
    const extraErrors = this.domainErrors(record.type, valid);
    const blocked = new Set(extraErrors.map((item) => item.rowNumber));
    const accepted = valid.filter((row) => !blocked.has(row.rowNumber));
    if (errors.length || extraErrors.length) {
      await this.prisma.dataImport.update({
        where: { id },
        data: {
          status: ImportStatus.FAILED,
          errors: [...errors, ...extraErrors] as Prisma.InputJsonValue,
          errorCount: errors.length + extraErrors.length,
        },
      });
      throw new BadRequestException('File failed validation on commit');
    }
    const preview = record.preview as { options?: { createMissingCostCodes?: boolean; createMissingSuppliers?: boolean } } | null;
    const result = await this.prisma.$transaction(async (tx) => {
      const applied = await applyImportRows(tx, record.type, accepted, {
        companyId,
        projectId: record.projectId!,
        userId,
        importId: id,
        createMissingCostCodes: preview?.options?.createMissingCostCodes,
        createMissingSuppliers: preview?.options?.createMissingSuppliers,
      });
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: AuditAction.IMPORT,
          module: 'EXCEL',
          entityType: EntityType.IMPORT,
          entityId: id,
          description: `Imported ${applied.created} ${record.type} rows`,
          source: 'USER',
        },
      });
      return tx.dataImport.update({
        where: { id },
        data: {
          status: ImportStatus.IMPORTED,
          completedAt: new Date(),
          errorCount: 0,
        },
      });
    });
    await this.profit.recalculate(companyId, record.projectId);
    return result;
  }

  async template(type: ImportType) {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(type);
    const fields = fieldsFor(type);
    sheet.addRow(fields.map((field) => field.key));
    sheet.addRow(fields.map((field) => field.label));
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportRows(type: ImportType, rows: Record<string, unknown>[]) {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(type);
    const fields = fieldsFor(type);
    sheet.addRow(fields.map((field) => field.key));
    for (const row of rows) {
      sheet.addRow(fields.map((field) => row[field.key] ?? ''));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async exportProject(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    const [costs, variations, claims, commitments, snapshot] = await Promise.all([
      this.prisma.actualCost.findMany({ where: { companyId, projectId } }),
      this.prisma.variation.findMany({ where: { companyId, projectId } }),
      this.prisma.progressClaim.findMany({ where: { companyId, projectId } }),
      this.prisma.commitment.findMany({ where: { companyId, projectId } }),
      this.profit.compute(companyId, projectId),
    ]);
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const profit = workbook.addWorksheet('Profit');
    profit.addRow(['Metric', 'Amount']);
    profit.addRow(['Original contract value', snapshot.originalContractValue.toFixed(2)]);
    profit.addRow(['Current approved contract value', snapshot.expectedRevenue.toFixed(2)]);
    profit.addRow(['Approved variations', snapshot.qualifyingVariationRevenue.toFixed(2)]);
    profit.addRow(['Pending variations', snapshot.unapprovedVariationExposure.toFixed(2)]);
    profit.addRow(['Original expected costs', snapshot.originalBudget.toFixed(2)]);
    profit.addRow(['Current approved budget', snapshot.currentBudget.toFixed(2)]);
    profit.addRow(['Actual costs', snapshot.actualCost.toFixed(2)]);
    profit.addRow(['Outstanding commitments', snapshot.openCommittedCost.toFixed(2)]);
    profit.addRow([
      'Forecast final costs',
      snapshot.costEstimateIncomplete ? 'Not yet estimated' : snapshot.forecastFinalCost.toFixed(2),
    ]);
    profit.addRow(['Original expected profit', snapshot.originalExpectedProfit.toFixed(2)]);
    profit.addRow([
      'Current forecast profit',
      snapshot.costEstimateIncomplete ? 'Uncertain' : snapshot.forecastProfit.toFixed(2),
    ]);
    profit.addRow(['Profit at risk', snapshot.profitAtRisk.toFixed(2)]);
    const costSheet = workbook.addWorksheet('Costs');
    costSheet.addRow(['Date', 'Description', 'Amount', 'Unallocated']);
    for (const item of costs) {
      costSheet.addRow([item.transactionDate, item.description, item.amount.toFixed(2), item.isUnallocated]);
    }
    const varSheet = workbook.addWorksheet('Variations');
    varSheet.addRow(['Number', 'Status', 'Selling price', 'Cost']);
    for (const item of variations) {
      varSheet.addRow([item.variationNo, item.status, item.sellingPrice.toFixed(2), item.contractorCost.toFixed(2)]);
    }
    const claimSheet = workbook.addWorksheet('Claims');
    claimSheet.addRow(['Claim', 'Status', 'Net amount']);
    for (const item of claims) {
      claimSheet.addRow([item.claimNo, item.status, item.netAmount.toFixed(2)]);
    }
    const commitSheet = workbook.addWorksheet('Commitments');
    commitSheet.addRow(['Status', 'Original', 'Remaining']);
    for (const item of commitments) {
      commitSheet.addRow([item.status, item.originalAmount.toFixed(2), item.remainingAmount.toFixed(2)]);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private domainErrors(type: ImportType, rows: ReturnType<typeof applyColumnMap>) {
    const errors: { rowNumber: number; field?: string; message: string }[] = [];
    if (type === ImportType.VARIATION) {
      for (const row of rows) {
        const status = row.values.status?.toUpperCase().replace(/[\s-]+/g, '_');
        if (status && !['DRAFT', 'SUBMITTED'].includes(status)) {
          errors.push({
            rowNumber: row.rowNumber,
            field: 'status',
            message: 'Imported variations must be DRAFT or SUBMITTED; approve them in CONSTRIQ so revenue is posted correctly',
          });
        }
      }
    }
    return errors;
  }

  private assertFile(file: { originalname: string; size: number }) {
    if (!file?.originalname) {
      throw new BadRequestException('File is required');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('File must be 15MB or smaller');
    }
    const lower = file.originalname.toLowerCase();
    if (!ALLOWED.some((ext) => lower.endsWith(ext))) {
      throw new BadRequestException('Upload an .xlsx or .csv file');
    }
  }
}
