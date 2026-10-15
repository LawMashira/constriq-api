import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { ProcurementController } from './procurement.controller';
import { ProcurementService } from './procurement.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [ProcurementController],
  providers: [ProcurementService],
})
export class ProcurementModule {}
