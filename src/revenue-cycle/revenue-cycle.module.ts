import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Post } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { IsMoney } from '../common/dto/money-field';
import { money, subtract, sum } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitEngineService } from '../profit-engine/profit-engine.service';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { PaymentStatus } from '@prisma/client';

class CreateClaimDto {
  @IsString()
  claimNo: string;

  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;

  @IsMoney()
  workCompleted: string;

  @IsMoney()
  retentionAmount: string;
}

class CertifyDto {
  @IsString()
  certificateNo: string;

  @IsMoney()
  certifiedAmount: string;

  @IsOptional()
  @IsMoney()
  amountRejected?: string;
}

class CreatePaymentDto {
  @IsMoney()
  amount: string;

  @IsDateString()
  paymentDate: string;

  @IsOptional()
  @IsString()
  supplierInvoiceId?: string;

  @IsOptional()
  @IsString()
  certificationId?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}

@Injectable()
class RevenueCycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
    private readonly profit: ProfitEngineService,
  ) {}

  async createClaim(companyId: string, projectId: string, dto: CreateClaimDto) {
    await this.projects.getWritable(companyId, projectId);
    const contracts = await this.prisma.contract.findMany({ where: { projectId, companyId } });
    const revised = contracts.reduce((total, item) => total.plus(item.revisedValue), money(0));
    const previous = await this.prisma.certification.aggregate({
      where: { projectId },
      _sum: { certifiedAmount: true },
    });
    const previousCertified = money(previous._sum.certifiedAmount ?? 0);
    const remaining = subtract(revised, previousCertified);
    const gross = money(dto.workCompleted);
    const retention = money(dto.retentionAmount);
    const currentAmount = subtract(gross, previousCertified);
    const net = subtract(currentAmount, retention);

    return this.prisma.progressClaim.create({
      data: {
        companyId,
        projectId,
        claimNo: dto.claimNo,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        workCompleted: gross,
        revisedContractValue: revised,
        remainingContractValue: remaining,
        grossAmount: gross,
        retentionAmount: retention,
        previousCertifiedAmount: previousCertified,
        currentAmount,
        netAmount: net,
      },
    });
  }

  async certify(companyId: string, projectId: string, claimId: string, dto: CertifyDto) {
    await this.projects.getWritable(companyId, projectId);
    const claim = await this.prisma.progressClaim.findFirst({
      where: { id: claimId, projectId, companyId },
    });
    if (!claim) {
      throw new BadRequestException('Claim not found');
    }
    const certified = await this.prisma.certification.create({
      data: {
        projectId,
        progressClaimId: claim.id,
        certificateNo: dto.certificateNo,
        amountSubmitted: claim.grossAmount,
        certifiedAmount: money(dto.certifiedAmount),
        amountRejected: money(dto.amountRejected ?? 0),
        retentionAmount: claim.retentionAmount,
        status: 'CERTIFIED',
        certifiedAt: new Date(),
      },
    });
    await this.profit.recalculate(companyId, projectId);
    return certified;
  }

  async pay(companyId: string, projectId: string, dto: CreatePaymentDto) {
    await this.projects.getWritable(companyId, projectId);
    if (dto.supplierInvoiceId) {
      const invoice = await this.prisma.supplierInvoice.findFirst({
        where: { id: dto.supplierInvoiceId, companyId, projectId },
        include: { payments: true },
      });
      if (!invoice) {
        throw new BadRequestException('Supplier invoice not found');
      }
    }
    const payment = await this.prisma.payment.create({
      data: {
        projectId,
        amount: money(dto.amount),
        paymentDate: new Date(dto.paymentDate),
        supplierInvoiceId: dto.supplierInvoiceId,
        certificationId: dto.certificationId,
        reference: dto.reference,
        status: 'PAID',
      },
    });
    if (dto.supplierInvoiceId) {
      const invoice = await this.prisma.supplierInvoice.findFirstOrThrow({
        where: { id: dto.supplierInvoiceId },
        include: { payments: true },
      });
      const paid = sum(invoice.payments.map((item) => item.amount));
      const total = money(invoice.totalAmount);
      const status = paid.lte(0)
        ? PaymentStatus.UNPAID
        : paid.gte(total)
          ? PaymentStatus.PAID
          : PaymentStatus.PARTIALLY_PAID;
      await this.prisma.supplierInvoice.update({
        where: { id: invoice.id },
        data: { paymentStatus: status },
      });
    }
    await this.profit.recalculate(companyId, projectId);
    return payment;
  }

  async listPayments(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.payment.findMany({
      where: { projectId },
      include: { supplierInvoice: { include: { supplier: true, purchaseOrder: true } } },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async listClaims(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.progressClaim.findMany({
      where: { projectId, companyId },
      include: { certifications: true, lines: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}

@Controller('projects/:projectId')
class RevenueCycleController {
  constructor(private readonly revenue: RevenueCycleService) {}

  @Get('progress-claims')
  @RequirePermissions('claim.read')
  listClaims(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.revenue.listClaims(user.companyId, projectId);
  }

  @Post('progress-claims')
  @RequirePermissions('claim.create')
  claim(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateClaimDto,
  ) {
    return this.revenue.createClaim(user.companyId, projectId, dto);
  }

  @Post('progress-claims/:claimId/certify')
  @RequirePermissions('claim.certify')
  certify(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('claimId') claimId: string,
    @Body() dto: CertifyDto,
  ) {
    return this.revenue.certify(user.companyId, projectId, claimId, dto);
  }

  @Post('payments')
  @RequirePermissions('payment.create')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.revenue.pay(user.companyId, projectId, dto);
  }

  @Get('payments')
  @RequirePermissions('payment.read')
  async listPayments(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.revenue.listPayments(user.companyId, projectId);
  }
}

@Module({
  imports: [ProfitEngineModule],
  controllers: [RevenueCycleController],
  providers: [RevenueCycleService],
})
export class RevenueCycleModule {}
