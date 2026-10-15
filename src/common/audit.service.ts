import { Injectable } from '@nestjs/common';
import { AuditAction, EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: {
      companyId: string;
      userId?: string;
      action: AuditAction;
      module: string;
      entityType?: EntityType;
      entityId?: string;
      description?: string;
      reason?: string;
      oldData?: Prisma.InputJsonValue;
      newData?: Prisma.InputJsonValue | Record<string, unknown>;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        action: input.action,
        module: input.module,
        entityType: input.entityType,
        entityId: input.entityId,
        description: input.description,
        reason: input.reason,
        oldData: input.oldData,
        newData: input.newData as Prisma.InputJsonValue | undefined,
        source: 'USER',
      },
    });
  }
}
