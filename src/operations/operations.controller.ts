import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  AllocateEquipmentDto,
  CertifySubcontractClaimDto,
  CreateEquipmentDto,
  CreateLabourDto,
  CreatePartyDto,
  CreatePlantDto,
  CreateSubcontractClaimDto,
  CreateSubcontractDto,
  CreateWorkerDto,
} from './operations.dto';
import { OperationsService } from './operations.service';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('subcontractors')
  @RequirePermissions('subcontractor.read')
  subcontractors(@CurrentUser() user: AuthUser) {
    return this.operations.listSubcontractors(user.companyId);
  }

  @Post('subcontractors')
  @RequirePermissions('subcontractor.create')
  createSub(@CurrentUser() user: AuthUser, @Body() dto: CreatePartyDto) {
    return this.operations.createSubcontractor(user.companyId, dto);
  }

  @Get('projects/:projectId/subcontracts')
  @RequirePermissions('subcontractor.read')
  listSubcontracts(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.operations.listSubcontracts(user.companyId, projectId);
  }

  @Post('projects/:projectId/subcontracts')
  @RequirePermissions('subcontractor.create')
  createSubcontract(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSubcontractDto,
  ) {
    return this.operations.createSubcontract(user.companyId, user.id, projectId, dto);
  }

  @Get('projects/:projectId/subcontract-claims')
  @RequirePermissions('subcontractor.read')
  listClaims(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.operations.listSubcontractClaims(user.companyId, projectId);
  }

  @Post('projects/:projectId/subcontract-claims')
  @RequirePermissions('subcontractor.create')
  createClaim(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSubcontractClaimDto,
  ) {
    return this.operations.createSubcontractClaim(user.companyId, projectId, dto);
  }

  @Post('projects/:projectId/subcontract-claims/:claimId/certify')
  @RequirePermissions('cost.approve')
  certifyClaim(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('claimId') claimId: string,
    @Body() dto: CertifySubcontractClaimDto,
  ) {
    return this.operations.certifySubcontractClaim(
      user.companyId,
      user.id,
      projectId,
      claimId,
      dto.certifiedAmount,
    );
  }

  @Get('labour/workers')
  @RequirePermissions('labour.read')
  workers(@CurrentUser() user: AuthUser) {
    return this.operations.listWorkers(user.companyId);
  }

  @Post('labour/workers')
  @RequirePermissions('labour.create')
  createWorker(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkerDto) {
    return this.operations.createWorker(user.companyId, dto);
  }

  @Get('projects/:projectId/labour')
  @RequirePermissions('labour.read')
  listLabour(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.operations.listLabour(user.companyId, projectId);
  }

  @Post('projects/:projectId/labour')
  @RequirePermissions('labour.create')
  labour(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateLabourDto,
  ) {
    return this.operations.addLabour(user.companyId, user.id, projectId, dto);
  }

  @Get('equipment')
  @RequirePermissions('cost.read')
  equipment(@CurrentUser() user: AuthUser) {
    return this.operations.listEquipment(user.companyId);
  }

  @Post('equipment')
  @RequirePermissions('cost.create')
  createEquipment(@CurrentUser() user: AuthUser, @Body() dto: CreateEquipmentDto) {
    return this.operations.createEquipment(user.companyId, dto);
  }

  @Post('projects/:projectId/equipment-allocations')
  @RequirePermissions('cost.create')
  allocate(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: AllocateEquipmentDto,
  ) {
    return this.operations.allocateEquipment(user.companyId, projectId, dto.equipmentId, dto.startDate);
  }

  @Get('projects/:projectId/plant')
  @RequirePermissions('cost.read')
  listPlant(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.operations.listPlant(user.companyId, projectId);
  }

  @Post('projects/:projectId/plant')
  @RequirePermissions('cost.create')
  plant(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePlantDto,
  ) {
    return this.operations.addPlant(user.companyId, user.id, projectId, dto);
  }
}
