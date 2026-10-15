import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ApprovalEntityType,
  ApprovalStatus,
  AuditAction,
  DocumentKind,
  EntityType,
  GeneratedReportType,
  NotificationStatus,
  SystemRole,
} from '@prisma/client';
import { matchingApprovalRule } from '../approvals/approval-match';
import { AuditService } from '../common/audit.service';
import { money } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { FileStorageService } from '../storage/file-storage.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class ManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profit: ProfitEngineService,
    private readonly storage: FileStorageService,
    private readonly audit: AuditService,
  ) {}

  notifications(user: AuthUser) {
    return this.prisma.notification.findMany({
      where: { companyId: user.companyId, userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(user: AuthUser, id: string) {
    const note = await this.prisma.notification.findFirst({
      where: { id, companyId: user.companyId, userId: user.id },
    });
    if (!note) {
      throw new BadRequestException('Notification not found');
    }
    return this.prisma.notification.update({
      where: { id },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
  }

  listDocuments(companyId: string, projectId?: string) {
    return this.prisma.document.findMany({
      where: { companyId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadDocument(
    user: AuthUser,
    file: { originalname: string; buffer: Buffer; mimetype: string; size: number },
    meta: { entityType: EntityType; entityId: string; projectId?: string; kind?: DocumentKind; name?: string },
  ) {
    const storageKey = await this.storage.saveBytes(
      `documents/${user.companyId}/${meta.entityId}`,
      file.originalname,
      file.buffer,
    );
    const document = await this.prisma.document.create({
      data: {
        companyId: user.companyId,
        uploadedById: user.id,
        entityType: meta.entityType,
        entityId: meta.entityId,
        projectId: meta.projectId,
        kind: meta.kind ?? DocumentKind.OTHER,
        name: meta.name ?? file.originalname,
        fileName: file.originalname,
        mimeType: file.mimetype,
        storageKey,
        fileSize: file.size,
      },
    });
    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      action: AuditAction.CREATE,
      module: 'DOCUMENTS',
      entityType: EntityType.DOCUMENT,
      entityId: document.id,
      description: `Document ${document.name} uploaded`,
    });
    return document;
  }

  async readDocument(companyId: string, id: string) {
    const document = await this.prisma.document.findFirst({ where: { id, companyId } });
    if (!document) {
      throw new BadRequestException('Document not found');
    }
    const buffer = await this.storage.read(document.storageKey);
    return { document, buffer };
  }

  listApprovalRules(companyId: string) {
    return this.prisma.approvalRule.findMany({ where: { companyId }, include: { role: true } });
  }

  createApprovalRule(
    companyId: string,
    dto: { entityType: ApprovalEntityType; minAmount: string; maxAmount?: string; roleId: string },
  ) {
    return this.prisma.approvalRule.create({
      data: {
        companyId,
        entityType: dto.entityType,
        minAmount: money(dto.minAmount),
        maxAmount: dto.maxAmount ? money(dto.maxAmount) : undefined,
        roleId: dto.roleId,
      },
    });
  }

  listApprovals(companyId: string, projectId?: string) {
    return this.prisma.approval.findMany({
      where: { companyId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestApproval(
    user: AuthUser,
    dto: { entityType: ApprovalEntityType; entityId: string; projectId?: string; amount?: string; comments?: string },
  ) {
    const amount = dto.amount ? money(dto.amount) : undefined;
    if (amount) {
      const rules = await this.prisma.approvalRule.findMany({
        where: { companyId: user.companyId, entityType: dto.entityType, active: true },
      });
      const rule = matchingApprovalRule(rules, amount);
      if (!rule) {
        const settings = await this.prisma.companySetting.findUnique({ where: { companyId: user.companyId } });
        if (settings?.defaultApprovalThreshold && amount.lt(settings.defaultApprovalThreshold)) {
          return { autoApproved: true, reason: 'Below company default approval threshold' };
        }
      }
    }
    return this.prisma.approval.create({
      data: {
        companyId: user.companyId,
        requestedById: user.id,
        entityType: dto.entityType,
        entityId: dto.entityId,
        projectId: dto.projectId,
        amount,
        comments: dto.comments,
      },
    });
  }

  async decide(user: AuthUser, approvalId: string, status: ApprovalStatus, comments?: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, companyId: user.companyId, status: ApprovalStatus.PENDING },
    });
    if (!approval) {
      throw new BadRequestException('Approval not found');
    }
    if (status !== ApprovalStatus.APPROVED && status !== ApprovalStatus.REJECTED) {
      throw new BadRequestException('Decision must be APPROVED or REJECTED');
    }
    const allowed = user.roles.includes(SystemRole.OWNER) || user.permissions.includes('company.settings');
    if (!allowed && !user.permissions.some((code) => code.endsWith('.approve'))) {
      throw new BadRequestException('You cannot decide this approval');
    }
    const updated = await this.prisma.approval.update({
      where: { id: approval.id },
      data: {
        status,
        approvedById: user.id,
        comments,
        decidedAt: new Date(),
      },
    });
    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      action: status === ApprovalStatus.APPROVED ? AuditAction.APPROVE : AuditAction.REJECT,
      module: 'APPROVALS',
      entityType: EntityType.APPROVAL,
      entityId: approval.id,
      description: `Approval ${status.toLowerCase()}`,
    });
    return updated;
  }

  async report(companyId: string, projectId: string, type: GeneratedReportType) {
    const snapshot = await this.profit.recalculate(companyId, projectId);
    const [costs, variations, claims, leakages] = await Promise.all([
      this.prisma.actualCost.findMany({ where: { companyId, projectId } }),
      this.prisma.variation.findMany({ where: { companyId, projectId } }),
      this.prisma.progressClaim.findMany({ where: { companyId, projectId } }),
      this.prisma.leakageFinding.findMany({ where: { companyId, projectId, status: 'OPEN' } }),
    ]);
    const cash = await this.profit.cashFlow(companyId, projectId);
    return {
      type,
      expectedProfit: snapshot.expectedProfit.toFixed(2),
      forecastProfit: snapshot.forecastProfit.toFixed(2),
      profitAtRisk: snapshot.profitAtRisk.toFixed(2),
      forecastMargin: snapshot.forecastMargin?.toFixed(4) ?? null,
      actualCosts: costs.map((item) => ({
        id: item.id,
        description: item.description,
        amount: item.amount.toFixed(2),
        date: item.transactionDate,
      })),
      variations: variations.map((item) => ({
        id: item.id,
        status: item.status,
        sellingPrice: item.sellingPrice.toFixed(2),
      })),
      claims: claims.map((item) => ({
        id: item.id,
        claimNo: item.claimNo,
        netAmount: item.netAmount.toFixed(2),
        status: item.status,
      })),
      leakages: leakages.map((item) => ({
        type: item.leakageType,
        amount: item.financialImpact.toFixed(2),
        title: item.title,
      })),
      cashFlow: cash,
    };
  }

  async listAudit(companyId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            roles: {
              where: { role: { companyId } },
              select: { role: { select: { name: true, systemRole: true } } },
            },
          },
        },
      },
    });
    const projects = await this.projectsForAudit(companyId, rows);
    return rows.map((row) => ({
      ...row,
      project: this.projectFromAudit(row, projects),
    }));
  }

  private async projectsForAudit(
    companyId: string,
    rows: Array<{ entityType: EntityType | null; entityId: string | null; newData: unknown }>,
  ) {
    const ids = (type: EntityType) =>
      [...new Set(rows.filter((row) => row.entityType === type && row.entityId).map((row) => row.entityId as string))];

    const projectIds = new Set(ids(EntityType.PROJECT));
    for (const row of rows) {
      const extra = this.projectIdFromData(row.newData);
      if (extra) projectIds.add(extra);
    }

    const pick = { id: true, projectId: true } as const;
    const [
      variations,
      costs,
      contracts,
      budgets,
      bills,
      orders,
      invoices,
      claims,
      forecasts,
      documents,
      imports,
      subcontracts,
      payments,
      scenarios,
      closeouts,
    ] = await Promise.all([
      this.idsQuery(ids(EntityType.VARIATION), (id) =>
        this.prisma.variation.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.ACTUAL_COST), (id) =>
        this.prisma.actualCost.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.CONTRACT), (id) =>
        this.prisma.contract.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.BUDGET), (id) =>
        this.prisma.projectBudget.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.BOQ), (id) =>
        this.prisma.boq.findMany({ where: { id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.PURCHASE_ORDER), (id) =>
        this.prisma.purchaseOrder.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.SUPPLIER_INVOICE), (id) =>
        this.prisma.supplierInvoice.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.PROGRESS_CLAIM), (id) =>
        this.prisma.progressClaim.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.FORECAST), (id) =>
        this.prisma.costForecast.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.DOCUMENT), (id) =>
        this.prisma.document.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.IMPORT), (id) =>
        this.prisma.dataImport.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.SUBCONTRACT), (id) =>
        this.prisma.subcontract.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.PAYMENT), (id) =>
        this.prisma.payment.findMany({ where: { id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.SCENARIO), (id) =>
        this.prisma.scenario.findMany({ where: { companyId, id: { in: id } }, select: pick }),
      ),
      this.idsQuery(ids(EntityType.CLOSEOUT), (id) =>
        this.prisma.projectCloseout.findMany({ where: { id: { in: id } }, select: { id: true, projectId: true } }),
      ),
    ]);

    const entityProject = new Map<string, string>();
    const link = (type: EntityType, items: Array<{ id: string; projectId?: string | null }>) => {
      for (const item of items) {
        if (item.projectId) {
          projectIds.add(item.projectId);
          entityProject.set(`${type}:${item.id}`, item.projectId);
        }
      }
    };
    link(EntityType.VARIATION, variations);
    link(EntityType.ACTUAL_COST, costs);
    link(EntityType.CONTRACT, contracts);
    link(EntityType.BUDGET, budgets);
    link(EntityType.BOQ, bills);
    link(EntityType.PURCHASE_ORDER, orders);
    link(EntityType.SUPPLIER_INVOICE, invoices);
    link(EntityType.PROGRESS_CLAIM, claims);
    link(EntityType.FORECAST, forecasts);
    link(EntityType.DOCUMENT, documents);
    link(EntityType.IMPORT, imports);
    link(EntityType.SUBCONTRACT, subcontracts);
    link(EntityType.PAYMENT, payments);
    link(EntityType.SCENARIO, scenarios);
    link(EntityType.CLOSEOUT, closeouts);
    for (const id of ids(EntityType.PROJECT)) {
      entityProject.set(`${EntityType.PROJECT}:${id}`, id);
    }

    const found = projectIds.size
      ? await this.prisma.project.findMany({
          where: { companyId, id: { in: [...projectIds] } },
          select: { id: true, code: true, name: true },
        })
      : [];
    return {
      byId: new Map(found.map((project) => [project.id, project])),
      entityProject,
    };
  }

  private idsQuery<T>(
    ids: string[],
    query: (ids: string[]) => Promise<T[]>,
  ): Promise<T[]> {
    if (!ids.length) return Promise.resolve([]);
    return query(ids);
  }

  private projectIdFromData(data: unknown): string | null {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const value = (data as { projectId?: unknown }).projectId;
    return typeof value === 'string' && value ? value : null;
  }

  private projectFromAudit(
    row: { entityType: EntityType | null; entityId: string | null; newData: unknown },
    maps: {
      byId: Map<string, { id: string; code: string; name: string }>;
      entityProject: Map<string, string>;
    },
  ) {
    const fromEntity =
      row.entityType && row.entityId ? maps.entityProject.get(`${row.entityType}:${row.entityId}`) : undefined;
    const fromData = this.projectIdFromData(row.newData);
    const projectId = fromEntity ?? fromData ?? undefined;
    return projectId ? maps.byId.get(projectId) ?? null : null;
  }
}
