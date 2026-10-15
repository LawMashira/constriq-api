import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
