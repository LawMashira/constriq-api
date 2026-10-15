import { Injectable } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_PREFIX: Partial<Record<EntityType, string>> = {
  PURCHASE_ORDER: 'PO',
  PROCUREMENT: 'PR',
  PROGRESS_CLAIM: 'PC',
  CERTIFICATION: 'CT',
  SUBCONTRACT: 'SC',
  SUBCONTRACT_CLAIM: 'SCL',
  VARIATION: 'VO',
  SUPPLIER_INVOICE: 'INV',
};

@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    companyId: string,
    entityType: EntityType,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    prefixOverride?: string,
  ) {
    const prefix = prefixOverride ?? DEFAULT_PREFIX[entityType] ?? entityType.slice(0, 3);
    const existing = await tx.documentSequence.findUnique({
      where: { companyId_entityType: { companyId, entityType } },
    });
    if (!existing) {
      const created = await tx.documentSequence.create({
        data: { companyId, entityType, prefix, nextNumber: 2, padding: 5 },
      });
      return formatNumber(created.prefix, 1, created.padding);
    }
    const updated = await tx.documentSequence.update({
      where: { id: existing.id },
      data: { nextNumber: { increment: 1 } },
    });
    return formatNumber(updated.prefix, updated.nextNumber - 1, updated.padding);
  }

  list(companyId: string) {
    return this.prisma.documentSequence.findMany({ where: { companyId } });
  }

  upsert(
    companyId: string,
    entityType: EntityType,
    input: { prefix: string; nextNumber?: number; padding?: number },
  ) {
    return this.prisma.documentSequence.upsert({
      where: { companyId_entityType: { companyId, entityType } },
      create: {
        companyId,
        entityType,
        prefix: input.prefix,
        nextNumber: input.nextNumber ?? 1,
        padding: input.padding ?? 5,
      },
      update: {
        prefix: input.prefix,
        ...(input.nextNumber != null ? { nextNumber: input.nextNumber } : {}),
        ...(input.padding != null ? { padding: input.padding } : {}),
      },
    });
  }
}

function formatNumber(prefix: string, n: number, padding: number) {
  return `${prefix}${String(n).padStart(padding, '0')}`;
}
