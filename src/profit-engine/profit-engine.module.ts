import { Module } from '@nestjs/common';
import { ProfitEngineController } from './profit-engine.controller';
import { ProfitEngineService } from './profit-engine.service';

@Module({
  controllers: [ProfitEngineController],
  providers: [ProfitEngineService],
  exports: [ProfitEngineService],
})
export class ProfitEngineModule {}
