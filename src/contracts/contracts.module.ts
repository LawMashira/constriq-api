import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
