import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountingModule } from './accounting/accounting.module';
import { AdministrationModule } from './administration/administration.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BoqModule } from './boq/boq.module';
import { BudgetsModule } from './budgets/budgets.module';
import { ClientsModule } from './clients/clients.module';
import { CloseoutModule } from './closeout/closeout.module';
import { CommonModule } from './common/common.module';
import { CompaniesModule } from './companies/companies.module';
import { ContractsModule } from './contracts/contracts.module';
import { CostCodesModule } from './cost-codes/cost-codes.module';
import { CostsModule } from './costs/costs.module';
import { ForecastingModule } from './forecasting/forecasting.module';
import { MailModule } from './mail/mail.module';
import { ManagementModule } from './management/management.module';
import { OperationsModule } from './operations/operations.module';
import { ExcelModule } from './excel/excel.module';
import { PdfModule } from './pdf/pdf.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProcurementModule } from './procurement/procurement.module';
import { ProfitEngineModule } from './profit-engine/profit-engine.module';
import { ProgressModule } from './progress/progress.module';
import { ProjectsModule } from './projects/projects.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { RevenueCycleModule } from './revenue-cycle/revenue-cycle.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { UsersModule } from './users/users.module';
import { VariationsModule } from './variations/variations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    MailModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    ClientsModule,
    ProjectsModule,
    ContractsModule,
    CostCodesModule,
    BoqModule,
    BudgetsModule,
    VariationsModule,
    CostsModule,
    ProfitEngineModule,
    ProcurementModule,
    OperationsModule,
    RevenueCycleModule,
    ForecastingModule,
    ExcelModule,
    PdfModule,
    ReconciliationModule,
    ProgressModule,
    CloseoutModule,
    ScenariosModule,
    ManagementModule,
    AccountingModule,
    AdministrationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
