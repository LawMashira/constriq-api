import { Module } from '@nestjs/common';
import { ExcelModule } from '../excel/excel.module';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { BoqController } from './boq.controller';
import { BoqService } from './boq.service';

@Module({
  imports: [ProfitEngineModule, ExcelModule],
  controllers: [BoqController],
  providers: [BoqService],
})
export class BoqModule {}
