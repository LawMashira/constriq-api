import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  ConvertProcurementRequestDto,
  CreateInvoiceDto,
  CreateProcurementRequestDto,
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  LinkInvoiceDto,
} from './dto';
import { ProcurementService } from './procurement.service';

@Controller()
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get('suppliers')
  @RequirePermissions('procurement.read')
  suppliers(@CurrentUser() user: AuthUser) {
    return this.procurement.listSuppliers(user.companyId);
  }

  @Post('suppliers')
  @RequirePermissions('procurement.create')
  createSupplier(@CurrentUser() user: AuthUser, @Body() dto: CreateSupplierDto) {
    return this.procurement.createSupplier(user.companyId, dto);
  }

  @Get('projects/:projectId/purchase-orders')
  @RequirePermissions('procurement.read')
  listPos(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.procurement.listPurchaseOrders(user.companyId, projectId);
  }

  @Post('projects/:projectId/purchase-orders')
  @RequirePermissions('procurement.create')
  createPo(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.procurement.createPurchaseOrder(user.companyId, user.id, projectId, dto);
  }

  @Get('projects/:projectId/supplier-invoices')
  @RequirePermissions('procurement.read')
  listInvoices(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.procurement.listInvoices(user.companyId, projectId);
  }

  @Post('projects/:projectId/supplier-invoices')
  @RequirePermissions('procurement.create')
  createInvoice(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.procurement.createInvoice(user.companyId, user.id, projectId, dto);
  }

  @Post('projects/:projectId/supplier-invoices/:invoiceId/link')
  @RequirePermissions('procurement.create')
  linkInvoice(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: LinkInvoiceDto,
  ) {
    return this.procurement.linkInvoice(user.companyId, user.id, projectId, invoiceId, dto.purchaseOrderId);
  }

  @Get('projects/:projectId/procurement-requests')
  @RequirePermissions('procurement.read')
  listRequests(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.procurement.listRequests(user.companyId, projectId);
  }

  @Post('projects/:projectId/procurement-requests')
  @RequirePermissions('procurement.read')
  createRequest(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProcurementRequestDto,
  ) {
    return this.procurement.createRequest(user, projectId, dto);
  }

  @Post('projects/:projectId/procurement-requests/:requestId/approve')
  @RequirePermissions('procurement.approve')
  approveRequest(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.procurement.approveRequest(user, projectId, requestId);
  }

  @Post('projects/:projectId/procurement-requests/:requestId/reject')
  @RequirePermissions('procurement.approve')
  rejectRequest(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.procurement.rejectRequest(user, projectId, requestId);
  }

  @Post('projects/:projectId/procurement-requests/:requestId/convert')
  @RequirePermissions('procurement.create')
  convert(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ConvertProcurementRequestDto,
  ) {
    return this.procurement.convertRequest(user.companyId, user.id, projectId, requestId, dto);
  }
}
