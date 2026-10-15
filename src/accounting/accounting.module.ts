import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { AccountingConnectionStatus, AccountingProvider as ProviderName, ReconciliationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { IsMoney } from '../common/dto/money-field';
import { money } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { NullAccountingProvider } from './accounting.provider';

class AccountingLineDto {
  @IsString()
  externalId: string;

  @IsMoney()
  amount: string;

  @IsString()
  date: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

class ImportCostsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountingLineDto)
  costs: AccountingLineDto[];
}

class ConnectDto {
  @IsOptional()
  @IsEnum(ProviderName)
  provider?: ProviderName;
}

@Injectable()
class AccountingService {
  private readonly provider = new NullAccountingProvider();

  constructor(private readonly prisma: PrismaService) {}

  async status(companyId: string) {
    const connections = await this.prisma.accountingConnection.findMany({ where: { companyId } });
    return {
      message: 'CONSTRIQ is not an accounting replacement. Imported ledgers are compared, never overwritten.',
      connections,
      liveProvider: connections.find((item) => item.status === AccountingConnectionStatus.CONNECTED)?.provider ?? 'none',
    };
  }

  connect(companyId: string, provider: ProviderName = ProviderName.GENERIC) {
    return this.prisma.accountingConnection.upsert({
      where: { companyId_provider: { companyId, provider } },
      create: {
        companyId,
        provider,
        status: AccountingConnectionStatus.CONNECTED,
        lastSyncAt: new Date(),
      },
      update: { status: AccountingConnectionStatus.CONNECTED, lastSyncAt: new Date() },
    });
  }

  async disconnect(companyId: string, provider: ProviderName = ProviderName.GENERIC) {
    await this.prisma.accountingConnection.updateMany({
      where: { companyId, provider },
      data: { status: AccountingConnectionStatus.DISCONNECTED },
    });
    return { status: AccountingConnectionStatus.DISCONNECTED };
  }

  async importCosts(companyId: string, costs: AccountingLineDto[]) {
    const created: Array<Record<string, unknown>> = [];
    for (const cost of costs) {
      if (!cost.projectId) {
        created.push({ ...cost, status: 'UNASSIGNED' });
        continue;
      }
      const internal = await this.prisma.actualCost.findFirst({
        where: {
          companyId,
          projectId: cost.projectId,
          OR: [
            { reference: cost.reference ?? cost.externalId },
            { amount: money(cost.amount) },
          ],
        },
      });
      const externalAmount = money(cost.amount);
      const internalAmount = internal ? money(internal.amount) : money(0);
      const variance = internalAmount.minus(externalAmount);
      const record = await this.prisma.reconciliationRecord.create({
        data: {
          companyId,
          projectId: cost.projectId,
          sourceType: 'ACTUAL_COST',
          sourceId: internal?.id ?? cost.externalId,
          externalType: 'ACCOUNTING_COST',
          externalId: cost.externalId,
          internalAmount,
          externalAmount,
          variance,
          status: !internal
            ? ReconciliationStatus.OPEN
            : variance.isZero()
              ? ReconciliationStatus.MATCHED
              : ReconciliationStatus.VARIANCE,
          notes: internal
            ? 'CONSTRIQ actual was not overwritten'
            : 'No matching CONSTRIQ actual; import is information only',
        },
      });
      created.push(record);
    }
    await this.prisma.accountingConnection.updateMany({
      where: { companyId, status: AccountingConnectionStatus.CONNECTED },
      data: { lastSyncAt: new Date() },
    });
    return { records: created, providerImport: await this.provider.importCosts() };
  }
}

@Controller('accounting')
class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('status')
  @RequirePermissions('reports.read')
  status(@CurrentUser() user: AuthUser) {
    return this.accounting.status(user.companyId);
  }

  @Post('connect')
  @RequirePermissions('company.settings')
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectDto) {
    return this.accounting.connect(user.companyId, dto.provider);
  }

  @Post('disconnect')
  @RequirePermissions('company.settings')
  disconnect(@CurrentUser() user: AuthUser, @Body() dto: ConnectDto) {
    return this.accounting.disconnect(user.companyId, dto.provider);
  }

  @Post('import/costs')
  @RequirePermissions('cost.read')
  importCosts(@CurrentUser() user: AuthUser, @Body() dto: ImportCostsDto) {
    return this.accounting.importCosts(user.companyId, dto.costs);
  }
}

@Module({
  controllers: [AccountingController],
  providers: [AccountingService],
})
export class AccountingModule {}
