import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AuditAction,
  CommitmentStatus,
  EntityType,
  FinancialPostingType,
  FinancialSourceType,
  Prisma,
  SubcontractClaimStatus,
} from '@prisma/client';
import { consumeUncommittedForecast, postActualCost } from '../common/actual-cost-posting';
import { AuditService } from '../common/audit.service';
import { money, rate, zero } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { SequenceService } from '../common/sequence.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import {
  CreateEquipmentDto,
  CreateLabourDto,
  CreatePartyDto,
  CreatePlantDto,
  CreateSubcontractClaimDto,
  CreateSubcontractDto,
  CreateWorkerDto,
} from './operations.dto';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly profit: ProfitEngineService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  listSubcontractors(companyId: string) {
    return this.prisma.subcontractor.findMany({
      where: { companyId },
      include: { performance: true },
      orderBy: { name: 'asc' },
    });
  }

  createSubcontractor(companyId: string, dto: CreatePartyDto) {
    return this.prisma.subcontractor.create({
      data: {
        companyId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        registrationNo: dto.registrationNo,
      },
    });
  }

  async listSubcontracts(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.subcontract.findMany({
      where: { projectId, companyId },
      include: { claims: true, subcontractor: true },
    });
  }

  async createSubcontract(companyId: string, userId: string, projectId: string, dto: CreateSubcontractDto) {
    await this.projects.getWritable(companyId, projectId);
    const subcontractor = await this.prisma.subcontractor.findFirst({
      where: { id: dto.subcontractorId, companyId },
    });
    if (!subcontractor) {
      throw new BadRequestException('Subcontractor not found');
    }
    const value = money(dto.originalValue);
    const created = await this.prisma.$transaction(async (tx) => {
      const contractNo = dto.contractNo ?? (await this.sequences.next(companyId, EntityType.SUBCONTRACT, tx));
      const subcontract = await tx.subcontract.create({
        data: {
          companyId,
          projectId,
          subcontractorId: dto.subcontractorId,
          costCodeId: dto.costCodeId,
          contractNo,
          description: dto.description,
          scope: dto.scope,
          originalValue: value,
          revisedValue: value,
          remainingCommitment: value,
          retentionPercent: dto.retentionPercent ? rate(dto.retentionPercent) : undefined,
        },
      });
      if (dto.costCodeId) {
        const commitment = await tx.commitment.create({
          data: {
            companyId,
            projectId,
            costCodeId: dto.costCodeId,
            subcontractId: subcontract.id,
            originalAmount: value,
            remainingAmount: value,
            status: CommitmentStatus.OPEN,
          },
        });
        const posting = await tx.financialPosting.create({
          data: {
            companyId,
            projectId,
            costCodeId: dto.costCodeId,
            postingType: FinancialPostingType.COMMITMENT,
            sourceType: FinancialSourceType.SUBCONTRACT,
            sourceId: commitment.id,
            amount: value,
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
          costCodeId: dto.costCodeId,
          amount: value,
        });
      }
      await this.audit.record(
        {
          companyId,
          userId,
          action: AuditAction.CREATE,
          module: 'SUBCONTRACTS',
          entityType: EntityType.SUBCONTRACT,
          entityId: subcontract.id,
          description: 'Subcontract created and commitment posted',
        },
        tx,
      );
      return subcontract;
    });
    await this.profit.recalculate(companyId, projectId);
    return created;
  }

  async listSubcontractClaims(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.subcontractClaim.findMany({
      where: { projectId },
      include: { subcontract: true },
      orderBy: { claimDate: 'desc' },
    });
  }

  async createSubcontractClaim(companyId: string, projectId: string, dto: CreateSubcontractClaimDto) {
    await this.projects.getWritable(companyId, projectId);
    const subcontract = await this.prisma.subcontract.findFirst({
      where: { id: dto.subcontractId, projectId, companyId },
    });
    if (!subcontract) {
      throw new BadRequestException('Subcontract not found');
    }
    const claimNo = dto.claimNo ?? (await this.sequences.next(companyId, EntityType.SUBCONTRACT_CLAIM));
    return this.prisma.subcontractClaim.create({
      data: {
        projectId,
        subcontractId: dto.subcontractId,
        claimNo,
        amount: money(dto.amount),
        claimDate: new Date(dto.claimDate),
        status: SubcontractClaimStatus.SUBMITTED,
      },
    });
  }

  async certifySubcontractClaim(
    companyId: string,
    userId: string,
    projectId: string,
    claimId: string,
    certifiedAmount: string,
  ) {
    await this.projects.getWritable(companyId, projectId);
    const claim = await this.prisma.subcontractClaim.findFirst({
      where: { id: claimId, projectId },
      include: { subcontract: true },
    });
    if (!claim) {
      throw new BadRequestException('Subcontract claim not found');
    }
    const certified = money(certifiedAmount);
    const retention = money(claim.subcontract.retentionPercent ?? 0)
      .div(100)
      .times(certified)
      .toDecimalPlaces(2);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subcontractClaim.update({
        where: { id: claim.id },
        data: {
          certifiedAmount: certified,
          retentionAmount: retention,
          status: SubcontractClaimStatus.CERTIFIED,
        },
      });
      const commitment = await tx.commitment.findFirst({
        where: { subcontractId: claim.subcontractId, status: { not: CommitmentStatus.CANCELLED } },
      });
      const posted = await postActualCost(tx, {
        companyId,
        projectId,
        costCodeId: claim.subcontract.costCodeId,
        createdById: userId,
        description: `Subcontract claim ${claim.claimNo}`,
        amount: certified,
        transactionDate: claim.claimDate,
        sourceType: FinancialSourceType.SUBCONTRACT_CLAIM,
        sourceId: claim.id,
        subcontractClaimId: claim.id,
        reference: claim.claimNo,
        consumeForecast: !commitment,
      });
      await tx.subcontractClaim.update({
        where: { id: claim.id },
        data: { financialPostingId: posted.posting.id },
      });
      if (commitment) {
        await reduceCommitment(tx, commitment.id, certified);
      }
      const remaining = money(claim.subcontract.remainingCommitment).minus(certified);
      await tx.subcontract.update({
        where: { id: claim.subcontractId },
        data: {
          claimsCertified: { increment: certified },
          remainingCommitment: remaining.lt(0) ? zero() : remaining,
        },
      });
      return updated;
    });
    await this.refreshSubcontractorPerformance(claim.subcontract.subcontractorId);
    await this.profit.recalculate(companyId, projectId);
    return result;
  }

  listWorkers(companyId: string) {
    return this.prisma.worker.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  createWorker(companyId: string, dto: CreateWorkerDto) {
    return this.prisma.worker.create({
      data: {
        companyId,
        name: dto.name,
        employeeNo: dto.employeeNo,
        trade: dto.trade,
        hourlyRate: dto.hourlyRate ? rate(dto.hourlyRate) : undefined,
      },
    });
  }

  async listLabour(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.labourRecord.findMany({
      where: { projectId },
      include: { worker: true },
      orderBy: { workDate: 'desc' },
    });
  }

  async addLabour(companyId: string, userId: string, projectId: string, dto: CreateLabourDto) {
    await this.projects.getWritable(companyId, projectId);
    const labourCost = money(rate(dto.hours).times(rate(dto.rate)));
    const overtime = dto.overtimeHours ? rate(dto.overtimeHours) : zero();
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.labourRecord.create({
        data: {
          projectId,
          workerId: dto.workerId,
          costCodeId: dto.costCodeId,
          workDate: new Date(dto.workDate),
          hours: rate(dto.hours),
          overtimeHours: overtime,
          rate: rate(dto.rate),
          amount: labourCost,
          isPosted: true,
        },
      });
      const posted = await postActualCost(tx, {
        companyId,
        projectId,
        costCodeId: dto.costCodeId,
        createdById: userId,
        description: 'Labour',
        amount: labourCost,
        transactionDate: new Date(dto.workDate),
        sourceType: FinancialSourceType.LABOUR_RECORD,
        sourceId: created.id,
        labourRecordId: created.id,
      });
      return tx.labourRecord.update({
        where: { id: created.id },
        data: { financialPostingId: posted.posting.id },
      });
    });
    await this.profit.recalculate(companyId, projectId);
    return record;
  }

  listEquipment(companyId: string) {
    return this.prisma.equipment.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  createEquipment(companyId: string, dto: CreateEquipmentDto) {
    return this.prisma.equipment.create({
      data: {
        companyId,
        name: dto.name,
        code: dto.code,
        ownership: dto.ownership,
        hireSupplierId: dto.hireSupplierId,
        hireRate: dto.hireRate ? rate(dto.hireRate) : undefined,
      },
    });
  }

  async allocateEquipment(companyId: string, projectId: string, equipmentId: string, startDate: string) {
    await this.projects.getWritable(companyId, projectId);
    const equipment = await this.prisma.equipment.findFirst({ where: { id: equipmentId, companyId } });
    if (!equipment) {
      throw new BadRequestException('Equipment not found');
    }
    return this.prisma.equipmentAllocation.create({
      data: { equipmentId, projectId, startDate: new Date(startDate) },
    });
  }

  async listPlant(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.plantRecord.findMany({
      where: { projectId },
      include: { equipment: true },
      orderBy: { workDate: 'desc' },
    });
  }

  async addPlant(companyId: string, userId: string, projectId: string, dto: CreatePlantDto) {
    await this.projects.getWritable(companyId, projectId);
    const amount = money(dto.amount);
    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.plantRecord.create({
        data: {
          projectId,
          equipmentId: dto.equipmentId,
          costCodeId: dto.costCodeId,
          description: dto.description,
          workDate: new Date(dto.workDate),
          operatingHours: dto.operatingHours ? rate(dto.operatingHours) : undefined,
          hireRate: dto.hireRate ? rate(dto.hireRate) : undefined,
          fuelCost: dto.fuelCost ? money(dto.fuelCost) : undefined,
          maintenanceCost: dto.maintenanceCost ? money(dto.maintenanceCost) : undefined,
          transportCost: dto.transportCost ? money(dto.transportCost) : undefined,
          amount,
          isPosted: true,
        },
      });
      const posted = await postActualCost(tx, {
        companyId,
        projectId,
        costCodeId: dto.costCodeId,
        createdById: userId,
        description: dto.description,
        amount,
        transactionDate: new Date(dto.workDate),
        sourceType: FinancialSourceType.PLANT_RECORD,
        sourceId: created.id,
        plantRecordId: created.id,
      });
      return tx.plantRecord.update({
        where: { id: created.id },
        data: { financialPostingId: posted.posting.id },
      });
    });
    await this.profit.recalculate(companyId, projectId);
    return record;
  }

  private async refreshSubcontractorPerformance(subcontractorId: string) {
    const claims = await this.prisma.subcontractClaim.findMany({ where: { subcontract: { subcontractorId } } });
    const submitted = claims.reduce((total, item) => total.plus(item.amount), zero());
    const certified = claims.reduce((total, item) => total.plus(item.certifiedAmount), zero());
    const discrepancy = submitted.minus(certified);
    await this.prisma.subcontractorPerformance.upsert({
      where: { subcontractorId },
      create: { subcontractorId, claimDiscrepancy: discrepancy, costVariance: discrepancy },
      update: { claimDiscrepancy: discrepancy, costVariance: discrepancy },
    });
  }
}

async function reduceCommitment(tx: Prisma.TransactionClient, commitmentId: string, invoiced: Prisma.Decimal) {
  const commitment = await tx.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
  const remaining = money(commitment.remainingAmount).minus(invoiced);
  const nextRemaining = remaining.lt(0) ? zero() : remaining;
  const invoicedAmount = money(commitment.invoicedAmount).plus(invoiced);
  await tx.commitment.update({
    where: { id: commitmentId },
    data: {
      remainingAmount: nextRemaining,
      invoicedAmount,
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
