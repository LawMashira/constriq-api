import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { ManagementController, ReportsController } from './management.controller';
import { ManagementService } from './management.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [ManagementController, ReportsController],
  providers: [ManagementService],
})
export class ManagementModule {}
