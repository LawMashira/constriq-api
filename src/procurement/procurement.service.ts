import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  CommitmentStatus,
  EntityType,
  FinancialPostingType,
  FinancialSourceType,
  MatchExceptionType,
  MatchStatus,
  PoStatus,
  Prisma,
  ProcurementStatus,
} from '@prisma/client';
import { consumeUncommittedForecast, postActualCost } from '../common/actual-cost-posting';
import { AuditService } from '../common/audit.service';
import { money, rate, sum, zero } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { SequenceService } from '../common/sequence.service';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import {
  ConvertProcurementRequestDto,
  CreateInvoiceDto,
  CreateProcurementRequestDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
} from './dto';
import { matchPurchaseOrderToInvoice, type MatchResult } from './three-way-match';

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly profit: ProfitEngineService,
    private readonly sequences: SequenceService,
  ) {}

  listSuppliers(companyId: string) {
    return this.prisma.supplier.findMany({
      where: { companyId },
      include: { performance: true },
      orderBy: { name: 'asc' },
    });
  }

  createSupplier(companyId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: { companyId, ...dto } });
  }

  async listPurchaseOrders(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.purchaseOrder.findMany({
      where: { companyId, projectId },
      include: {
        lines: { include: { costCode: true } },
        supplier: true,
        procurementRequests: { select: { id: true, requestNumber: true, description: true } },
        invoices: { include: { payments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listInvoices(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    const rows = await this.prisma.supplierInvoice.findMany({
      where: { companyId, projectId },
      include: {
        lines: { include: { costCode: true } },
        supplier: true,
        purchaseOrder: { include: { lines: { include: { costCode: true } }, supplier: true } },
        payments: true,
      },
      orderBy: { invoiceDate: 'desc' },
    });
    return rows.map((invoice) => ({
      ...invoice,
      match: explainInvoiceMatch(invoice),
    }));
  }

  async listRequests(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    const orphans = await this.prisma.procurementRequest.findMany({
      where: { projectId, requestedById: null },
      select: { id: true },
    });
    if (orphans.length) {
      const owners = await this.prisma.userRole.findMany({
        where: { role: { companyId, systemRole: 'OWNER' } },
        select: { userId: true },
      });
      const uniqueOwners = [...new Set(owners.map((item) => item.userId))];
      if (uniqueOwners.length === 1) {
        await this.prisma.procurementRequest.updateMany({
          where: { projectId, requestedById: null },
          data: { requestedById: uniqueOwners[0] },
        });
      }
    }
    const unnumbered = await this.prisma.procurementRequest.findMany({
      where: { projectId, requestNumber: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of unnumbered) {
      const requestNumber = await this.sequences.next(companyId, EntityType.PROCUREMENT, this.prisma, 'REQ');
      await this.prisma.procurementRequest.update({
        where: { id: row.id },
        data: { requestNumber },
      });
    }
    const rows = await this.prisma.procurementRequest.findMany({
      where: { projectId },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serializeRequest);
  }

  async createRequest(user: AuthUser, projectId: string, dto: CreateProcurementRequestDto) {
    assertCanRaiseRequest(user);
    await this.projects.getWritable(user.companyId, projectId);
    const amount = money(rate(dto.quantity).times(rate(dto.rate)));
    const created = await this.prisma.$transaction(async (tx) => {
      const requestNumber = await this.sequences.next(user.companyId, EntityType.PROCUREMENT, tx, 'REQ');
      return tx.procurementRequest.create({
        data: {
          projectId,
          supplierId: dto.supplierId,
          costCodeId: dto.costCodeId,
          requestedById: user.id,
          requestNumber,
          description: dto.description,
          reason: dto.reason,
          quantity: rate(dto.quantity),
          unit: dto.unit,
          rate: rate(dto.rate),
          amount,
          requiredDate: dto.requiredDate ? new Date(dto.requiredDate) : undefined,
          status: ProcurementStatus.PENDING_APPROVAL,
        },
        include: requestInclude,
      });
    });
    return serializeRequest(created);
  }

  async approveRequest(user: AuthUser, projectId: string, requestId: string) {
    await this.projects.getWritable(user.companyId, projectId);
    const request = await this.loadRequest(projectId, requestId);
    if (request.status !== ProcurementStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only a pending request can be approved');
    }
    return serializeRequest(
      await this.prisma.procurementRequest.update({
        where: { id: request.id },
        data: {
          status: ProcurementStatus.APPROVED,
          approvedById: user.id,
          approvedAt: new Date(),
        },
        include: requestInclude,
      }),
    );
  }

  async rejectRequest(user: AuthUser, projectId: string, requestId: string) {
    await this.projects.getWritable(user.companyId, projectId);
    const request = await this.loadRequest(projectId, requestId);
    if (request.status !== ProcurementStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only a pending request can be rejected');
    }
    return serializeRequest(
      await this.prisma.procurementRequest.update({
        where: { id: request.id },
        data: {
          status: ProcurementStatus.REJECTED,
          approvedById: user.id,
          rejectedAt: new Date(),
        },
        include: requestInclude,
      }),
    );
  }

  async convertRequest(
    companyId: string,
    userId: string,
    projectId: string,
    requestId: string,
    dto: ConvertProcurementRequestDto,
  ) {
    const request = await this.loadRequest(projectId, requestId);
    if (request.status !== ProcurementStatus.APPROVED) {
      throw new BadRequestException('Approve this request before converting it to a purchase order');
    }
    if (!request.costCodeId) {
      throw new BadRequestException('Request needs a cost code before conversion');
    }
    let requestNumber = request.requestNumber;
    if (!requestNumber) {
      requestNumber = await this.sequences.next(companyId, EntityType.PROCUREMENT, this.prisma, 'REQ');
    }
    const po = await this.createPurchaseOrder(companyId, userId, projectId, {
      supplierId: dto.supplierId,
      lines: [
        {
          costCodeId: request.costCodeId,
          description: request.description,
          quantity: request.quantity.toFixed(4),
          unitRate: request.rate.toFixed(4),
        },
      ],
    });
    await this.prisma.procurementRequest.update({
      where: { id: request.id },
      data: {
        status: ProcurementStatus.CONVERTED_TO_PO,
        supplierId: dto.supplierId,
        purchaseOrderId: po.id,
        requestNumber,
      },
    });
    return po;
  }

  private async loadRequest(projectId: string, requestId: string) {
    const request = await this.prisma.procurementRequest.findFirst({
      where: { id: requestId, projectId },
    });
    if (!request) {
      throw new BadRequestException('Procurement request not found');
    }
    return request;
  }

  async createPurchaseOrder(
    companyId: string,
    userId: string,
    projectId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    await this.projects.getWritable(companyId, projectId);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId },
    });
    if (!supplier) {
      throw new BadRequestException('Supplier not found');
    }
    const lineTotals = dto.lines.map((line) => money(rate(line.quantity).times(rate(line.unitRate))));
    const subtotal = sum(lineTotals);

    const po = await this.prisma.$transaction(async (tx) => {
      const poNumber = dto.poNumber ?? (await this.sequences.next(companyId, EntityType.PURCHASE_ORDER, tx));
      const created = await tx.purchaseOrder.create({
        data: {
          companyId,
          projectId,
          supplierId: dto.supplierId,
          poNumber,
          subtotal,
          totalAmount: subtotal,
          status: PoStatus.APPROVED,
          approvedAt: new Date(),
          lines: {
            create: dto.lines.map((line, index) => ({
              costCodeId: line.costCodeId,
              description: line.description,
              quantity: rate(line.quantity),
              unitRate: rate(line.unitRate),
              totalAmount: lineTotals[index],
            })),
          },
        },
        include: { lines: true },
      });

      for (const line of created.lines) {
        const commitment = await tx.commitment.create({
          data: {
            companyId,
            projectId,
            costCodeId: line.costCodeId,
            supplierId: dto.supplierId,
            purchaseOrderId: created.id,
            originalAmount: line.totalAmount,
            remainingAmount: line.totalAmount,
            status: CommitmentStatus.OPEN,
          },
        });
        const posting = await tx.financialPosting.create({
          data: {
            companyId,
            projectId,
            costCodeId: line.costCodeId,
            postingType: FinancialPostingType.COMMITMENT,
            sourceType: FinancialSourceType.PURCHASE_ORDER,
            sourceId: commitment.id,
            amount: line.totalAmount,
            postingDate: new Date(),
          },
        });
        await tx.commitment.update({
          where: { id: commitment.id },
          data: { financialPostingId: posting.id },
        });
        await consumeUncommittedForecast(tx, {
          companyId,
          projectId,
          costCodeId: line.costCodeId,
          amount: line.totalAmount,
        });
      }

      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'PROCUREMENT',
          entityType: EntityType.PURCHASE_ORDER,
          entityId: created.id,
          description: 'Purchase order approved and commitments posted',
        },
        tx,
      );
      return created;
    });

    await this.profit.recalculate(companyId, projectId);
    return po;
  }

  async createInvoice(companyId: string, userId: string, projectId: string, dto: CreateInvoiceDto) {
    await this.projects.getWritable(companyId, projectId);
    const duplicate = await this.prisma.supplierInvoice.findUnique({
      where: {
        supplierId_invoiceNumber: { supplierId: dto.supplierId, invoiceNumber: dto.invoiceNumber },
      },
    });
    if (duplicate) {
      throw new BadRequestException('Duplicate supplier invoice');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId },
    });
    if (!supplier) {
      throw new BadRequestException('Supplier not found');
    }

    const po = dto.purchaseOrderId
      ? await this.prisma.purchaseOrder.findFirst({
          where: { id: dto.purchaseOrderId, companyId, projectId },
          include: { lines: { include: { costCode: true } }, supplier: true },
        })
      : null;

    const lines = dto.lines.map((line, index) => {
      const poLine = po?.lines[index] ?? po?.lines.find((item) => item.id === line.purchaseOrderLineId);
      return {
        ...line,
        purchaseOrderLineId: line.purchaseOrderLineId ?? poLine?.id,
        costCodeId: line.costCodeId || poLine?.costCodeId,
        description: line.description || poLine?.description || 'Invoice line',
        quantity: line.quantity || poLine?.quantity.toFixed(4) || '0',
        unitRate: line.unitRate || poLine?.unitRate.toFixed(4) || '0',
      };
    });

    const lineTotals = lines.map((line) => money(rate(line.quantity).times(rate(line.unitRate))));
    const subtotal = money(dto.subtotal);
    const total = subtotal.plus(dto.taxAmount);

    let match: MatchResult = {
      matched: true,
      issues: [],
      checks: [],
      summary: 'Direct invoice. Not compared to a purchase order.',
    };
    if (po) {
      match = matchPurchaseOrderToInvoice({
        poAmount: po.totalAmount,
        invoiceAmount: subtotal,
        poQuantity: po.lines.reduce((sumQty, line) => sumQty.plus(line.quantity), money(0)),
        invoiceQuantity: lines.reduce((sumQty, line) => sumQty.plus(rate(line.quantity)), money(0)),
        poProjectId: po.projectId,
        invoiceProjectId: projectId,
        poSupplierId: po.supplierId,
        invoiceSupplierId: dto.supplierId,
        poCostCodeIds: po.lines.map((line) => line.costCodeId),
        invoiceCostCodeIds: lines.map((line) => line.costCodeId).filter((id): id is string => !!id),
        poSupplierName: po.supplier?.name,
        invoiceSupplierName: supplier.name,
        poCostCodeLabels: po.lines.map((line) => line.costCode?.code ?? line.costCodeId),
        invoiceCostCodeLabels: lines.map((line) => line.costCodeId ?? ''),
        poDescriptions: po.lines.map((line) => line.description),
        invoiceDescriptions: lines.map((line) => line.description),
      });
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierInvoice.create({
        data: {
          companyId,
          projectId,
          supplierId: dto.supplierId,
          purchaseOrderId: dto.purchaseOrderId,
          invoiceNumber: dto.invoiceNumber,
          invoiceDate: new Date(dto.invoiceDate),
          subtotal,
          taxAmount: money(dto.taxAmount),
          totalAmount: total,
          matchStatus: match.matched ? MatchStatus.MATCHED : MatchStatus.MISMATCH,
          exceptionType: exceptionTypeFor(match),
          lines: {
            create: lines.map((line, index) => ({
              purchaseOrderLineId: line.purchaseOrderLineId,
              costCodeId: line.costCodeId,
              description: line.description,
              quantity: rate(line.quantity),
              unitRate: rate(line.unitRate),
              totalAmount: lineTotals[index],
              matchStatus: match.matched ? MatchStatus.MATCHED : MatchStatus.MISMATCH,
            })),
          },
        },
        include: { lines: true },
      });

      if (match.matched) {
        for (const line of created.lines) {
          await postActualCost(tx, {
            companyId,
            projectId,
            costCodeId: line.costCodeId,
            createdById: userId,
            description: line.description,
            amount: line.totalAmount,
            transactionDate: created.invoiceDate,
            sourceType: FinancialSourceType.SUPPLIER_INVOICE,
            sourceId: line.id,
            invoiceId: created.id,
            supplierId: dto.supplierId,
            reference: created.invoiceNumber,
            consumeForecast: !created.purchaseOrderId,
          });
          if (created.purchaseOrderId && line.costCodeId) {
            const commitment = await tx.commitment.findFirst({
              where: {
                purchaseOrderId: created.purchaseOrderId,
                costCodeId: line.costCodeId,
                status: { not: CommitmentStatus.CANCELLED },
              },
            });
            if (commitment) {
              await reduceCommitment(tx, commitment.id, line.totalAmount);
            }
          }
        }
      }

      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'PROCUREMENT',
          entityType: EntityType.SUPPLIER_INVOICE,
          entityId: created.id,
          description: match.matched ? 'Supplier invoice matched and posted as actual' : 'Supplier invoice mismatch',
          newData: match as object,
        },
        tx,
      );
      return created;
    });

    if (match.matched) {
      await this.refreshSupplierPerformance(dto.supplierId);
      await this.profit.recalculate(companyId, projectId);
    }

    return { ...invoice, match };
  }

  async linkInvoice(
    companyId: string,
    userId: string,
    projectId: string,
    invoiceId: string,
    purchaseOrderId: string,
  ) {
    await this.projects.getWritable(companyId, projectId);
    const invoice = await this.prisma.supplierInvoice.findFirst({
      where: { id: invoiceId, companyId, projectId },
      include: {
        lines: { include: { costCode: true } },
        supplier: true,
        actualCosts: true,
      },
    });
    if (!invoice) {
      throw new BadRequestException('Invoice not found');
    }
    if (invoice.purchaseOrderId) {
      throw new BadRequestException('This invoice is already linked to a purchase order');
    }
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId, projectId },
      include: { lines: { include: { costCode: true } }, supplier: true },
    });
    if (!po) {
      throw new BadRequestException('Purchase order not found');
    }

    const match = matchPurchaseOrderToInvoice({
      poAmount: po.totalAmount,
      invoiceAmount: invoice.subtotal,
      poQuantity: po.lines.reduce((sumQty, line) => sumQty.plus(line.quantity), money(0)),
      invoiceQuantity: invoice.lines.reduce((sumQty, line) => sumQty.plus(line.quantity), money(0)),
      poProjectId: po.projectId,
      invoiceProjectId: invoice.projectId,
      poSupplierId: po.supplierId,
      invoiceSupplierId: invoice.supplierId,
      poCostCodeIds: po.lines.map((line) => line.costCodeId),
      invoiceCostCodeIds: invoice.lines.map((line) => line.costCodeId).filter((id): id is string => !!id),
      poSupplierName: po.supplier?.name,
      invoiceSupplierName: invoice.supplier?.name,
      poCostCodeLabels: po.lines.map((line) => line.costCode?.code ?? line.costCodeId),
      invoiceCostCodeLabels: invoice.lines.map((line) => line.costCode?.code ?? line.costCodeId ?? ''),
      poDescriptions: po.lines.map((line) => line.description),
      invoiceDescriptions: invoice.lines.map((line) => line.description),
    });

    const alreadyPosted = invoice.actualCosts.length > 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          purchaseOrderId: po.id,
          matchStatus: match.matched ? MatchStatus.MATCHED : MatchStatus.MISMATCH,
          exceptionType: exceptionTypeFor(match),
        },
      });
      for (const [index, line] of invoice.lines.entries()) {
        const poLine = po.lines[index] ?? po.lines[0];
        await tx.supplierInvoiceLine.update({
          where: { id: line.id },
          data: {
            purchaseOrderLineId: poLine?.id,
            matchStatus: match.matched ? MatchStatus.MATCHED : MatchStatus.MISMATCH,
          },
        });
      }
      if (match.matched) {
        for (const line of invoice.lines) {
          if (!alreadyPosted) {
            await postActualCost(tx, {
              companyId,
              projectId,
              costCodeId: line.costCodeId,
              createdById: userId,
              description: line.description,
              amount: line.totalAmount,
              transactionDate: invoice.invoiceDate,
              sourceType: FinancialSourceType.SUPPLIER_INVOICE,
              sourceId: line.id,
              invoiceId: invoice.id,
              supplierId: invoice.supplierId,
              reference: invoice.invoiceNumber,
              consumeForecast: false,
            });
          }
          if (line.costCodeId) {
            const commitment = await tx.commitment.findFirst({
              where: {
                purchaseOrderId: po.id,
                costCodeId: line.costCodeId,
                status: { not: CommitmentStatus.CANCELLED },
              },
            });
            if (commitment) {
              await reduceCommitment(tx, commitment.id, line.totalAmount);
            }
          }
        }
      }
      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.UPDATE,
          module: 'PROCUREMENT',
          entityType: EntityType.SUPPLIER_INVOICE,
          entityId: invoice.id,
          description: `Invoice ${invoice.invoiceNumber} linked to PO ${po.poNumber}`,
          newData: match as object,
        },
        tx,
      );
    });

    if (match.matched) {
      await this.refreshSupplierPerformance(invoice.supplierId);
      await this.profit.recalculate(companyId, projectId);
    }

    const linked = await this.prisma.supplierInvoice.findFirstOrThrow({
      where: { id: invoice.id },
      include: {
        lines: { include: { costCode: true } },
        supplier: true,
        purchaseOrder: { include: { lines: { include: { costCode: true } }, supplier: true } },
      },
    });
    return { ...linked, match: explainInvoiceMatch(linked) };
  }

  private async refreshSupplierPerformance(supplierId: string) {
    const invoices = await this.prisma.supplierInvoice.findMany({ where: { supplierId } });
    const mismatches = invoices.filter((item) => item.matchStatus === MatchStatus.MISMATCH).length;
    await this.prisma.supplierPerformance.upsert({
      where: { supplierId },
      create: { supplierId, qualityIssueCount: mismatches },
      update: { qualityIssueCount: mismatches },
    });
  }
}

const actorInclude = {
  select: {
    id: true,
    name: true,
    roles: { select: { role: { select: { name: true } } } },
  },
};

const requestInclude = {
  requestedBy: actorInclude,
  approvedBy: actorInclude,
  costCode: true,
  supplier: true,
  purchaseOrder: { select: { id: true, poNumber: true, totalAmount: true } },
};

function toActor(
  user:
    | {
        id: string;
        name: string;
        roles: { role: { name: string } }[];
      }
    | null
    | undefined,
) {
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.roles[0]?.role.name ?? null };
}

function serializeRequest<T extends { requestedBy?: unknown; approvedBy?: unknown }>(row: T) {
  const record = row as T & {
    requestedBy?: { id: string; name: string; roles: { role: { name: string } }[] } | null;
    approvedBy?: { id: string; name: string; roles: { role: { name: string } }[] } | null;
  };
  return {
    ...record,
    requestedBy: toActor(record.requestedBy),
    approvedBy: toActor(record.approvedBy),
  };
}

function assertCanRaiseRequest(user: AuthUser) {
  if (user.permissions.includes('procurement.request') || user.permissions.includes('procurement.create')) {
    return;
  }
  throw new ForbiddenException('Insufficient permissions');
}

function exceptionTypeFor(match: MatchResult): MatchExceptionType | undefined {
  const type = match.issues[0]?.type;
  if (type === 'INVOICE_EXCEEDS_PO') return MatchExceptionType.INVOICE_GREATER_THAN_PO;
  if (type === 'QUANTITY_GREATER_THAN_ORDERED') return MatchExceptionType.QUANTITY_GREATER_THAN_ORDERED;
  if (type === 'INCORRECT_PROJECT') return MatchExceptionType.INCORRECT_PROJECT;
  if (type === 'INCORRECT_COST_CODE') return MatchExceptionType.INCORRECT_COST_CODE;
  return undefined;
}

function explainInvoiceMatch(invoice: {
  purchaseOrderId: string | null;
  projectId: string;
  supplierId: string;
  totalAmount: Prisma.Decimal;
  supplier?: { name: string } | null;
  lines: { quantity: Prisma.Decimal; costCodeId: string | null; description: string; costCode?: { code: string } | null }[];
  purchaseOrder?: {
    projectId: string;
    supplierId: string;
    totalAmount: Prisma.Decimal;
    supplier?: { name: string } | null;
    lines: { quantity: Prisma.Decimal; costCodeId: string; description: string; costCode?: { code: string } | null }[];
  } | null;
}): MatchResult {
  if (!invoice.purchaseOrder) {
    return {
      matched: true,
      issues: [],
      checks: [],
      summary: 'Direct invoice. Not compared to a purchase order.',
    };
  }
  const po = invoice.purchaseOrder;
  return matchPurchaseOrderToInvoice({
    poAmount: po.totalAmount,
    invoiceAmount: invoice.totalAmount,
    poQuantity: po.lines.reduce((sumQty, line) => sumQty.plus(line.quantity), money(0)),
    invoiceQuantity: invoice.lines.reduce((sumQty, line) => sumQty.plus(line.quantity), money(0)),
    poProjectId: po.projectId,
    invoiceProjectId: invoice.projectId,
    poSupplierId: po.supplierId,
    invoiceSupplierId: invoice.supplierId,
    poCostCodeIds: po.lines.map((line) => line.costCodeId),
    invoiceCostCodeIds: invoice.lines.map((line) => line.costCodeId).filter((id): id is string => !!id),
    poSupplierName: po.supplier?.name,
    invoiceSupplierName: invoice.supplier?.name,
    poCostCodeLabels: po.lines.map((line) => line.costCode?.code ?? line.costCodeId),
    invoiceCostCodeLabels: invoice.lines.map((line) => line.costCode?.code ?? line.costCodeId ?? ''),
    poDescriptions: po.lines.map((line) => line.description),
    invoiceDescriptions: invoice.lines.map((line) => line.description),
  });
}

async function reduceCommitment(tx: Prisma.TransactionClient, commitmentId: string, invoiced: Prisma.Decimal) {
  const commitment = await tx.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
  const remaining = money(commitment.remainingAmount).minus(invoiced);
  const nextRemaining = remaining.lt(0) ? zero() : remaining;
  await tx.commitment.update({
    where: { id: commitmentId },
    data: {
      remainingAmount: nextRemaining,
      invoicedAmount: money(commitment.invoicedAmount).plus(invoiced),
      status: nextRemaining.isZero() ? CommitmentStatus.FULLY_INVOICED : CommitmentStatus.PARTIALLY_INVOICED,
    },
  });
  if (commitment.financialPostingId) {
    await tx.financialPosting.update({
      where: { id: commitment.financialPostingId },
      data: { amount: nextRemaining },
    });
  }
}
