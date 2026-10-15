import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportType } from '@prisma/client';
import { money, rate } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileStorageService } from '../storage/file-storage.service';
import { cleanNumber, seedCommercialFromBoq } from '../excel/apply-import';
import { suggestColumnMap, type ColumnMap } from '../excel/import-fields';
import { applyColumnMap, type ParsedSheet } from '../excel/mapping';
import { CreateBoqDto } from './dto/create-boq.dto';

@Injectable()
export class BoqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly profit: ProfitEngineService,
    private readonly storage: FileStorageService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.boq.findMany({
      where: { projectId },
      include: { items: true },
      orderBy: { version: 'desc' },
    });
  }

  async create(companyId: string, projectId: string, dto: CreateBoqDto) {
    await this.projects.getWritable(companyId, projectId);
    const latest = await this.prisma.boq.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    return this.prisma.boq.create({
      data: {
        projectId,
        name: dto.name,
        version,
        items: {
          create: dto.items.map((item) => ({
            itemCode: item.itemCode,
            description: item.description,
            section: item.section,
            costCodeId: item.costCodeId,
            quantity: rate(item.quantity),
            unit: item.unit,
            rate: rate(item.rate),
            amount: money(rate(item.quantity).times(rate(item.rate))),
          })),
        },
      },
      include: { items: true },
    });
  }

  async adoptCommercial(companyId: string, userId: string, projectId: string) {
    await this.projects.getWritable(companyId, projectId);
    const latest = await this.prisma.boq.findFirst({
      where: { projectId },
      include: { items: true },
      orderBy: { version: 'desc' },
    });
    if (!latest?.items.length) {
      return { seeded: false };
    }

    const costByItem = await this.costAmountsFromImport(companyId, latest.importId);
    const seedItems = latest.items.map((item) => ({
      ...item,
      costAmount: costByItem.get(item.itemCode) ?? item.amount,
    }));

    const result = await this.prisma.$transaction((tx) =>
      seedCommercialFromBoq(
        tx,
        {
          companyId,
          projectId,
          userId,
          importId: latest.importId ?? latest.id,
          createMissingCostCodes: true,
        },
        seedItems,
      ),
    );
    if (result.seeded) {
      await this.profit.recalculate(companyId, projectId);
    }
    return result;
  }

  private async costAmountsFromImport(companyId: string, importId: string | null) {
    const costs = new Map<string, ReturnType<typeof money>>();
    if (!importId) {
      return costs;
    }
    const record = await this.prisma.dataImport.findFirst({
      where: { id: importId, companyId },
    });
    if (!record?.columnMap) {
      return costs;
    }
    try {
      const sheet = await this.storage.readJson<ParsedSheet>(`imports/${companyId}/${importId}/sheet.json`);
      const columnMap = { ...((record.columnMap ?? {}) as ColumnMap) };
      if (!columnMap.costRate) {
        const suggested = suggestColumnMap(sheet.headers, ImportType.BOQ);
        if (suggested.costRate) {
          columnMap.costRate = suggested.costRate;
        }
      }
      const mapped = applyColumnMap(sheet, ImportType.BOQ, columnMap);
      for (const row of mapped) {
        if (!row.values.itemCode || !row.values.costRate) {
          continue;
        }
        const quantity = rate(cleanNumber(row.values.quantity || '0'));
        costs.set(row.values.itemCode, money(quantity.times(rate(cleanNumber(row.values.costRate)))));
      }
    } catch {
      return costs;
    }
    return costs;
  }

  async updateItem(
    companyId: string,
    projectId: string,
    itemId: string,
    dto: Partial<{ description: string; quantity: string; rate: string; costCodeId: string }>,
  ) {
    await this.projects.getWritable(companyId, projectId);
    const item = await this.prisma.boqItem.findFirst({
      where: { id: itemId, boq: { projectId } },
    });
    if (!item) {
      throw new NotFoundException('BOQ item not found');
    }
    const quantity = dto.quantity ? rate(dto.quantity) : item.quantity;
    const itemRate = dto.rate ? rate(dto.rate) : item.rate;
    return this.prisma.boqItem.update({
      where: { id: itemId },
      data: {
        description: dto.description,
        quantity,
        rate: itemRate,
        costCodeId: dto.costCodeId,
        amount: money(quantity.times(itemRate)),
      },
    });
  }
}
