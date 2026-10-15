import { Module } from '@nestjs/common';
import { CostCodesController, CostCodeTemplatesController } from './cost-codes.controller';
import { CostCodesService } from './cost-codes.service';

@Module({
  controllers: [CostCodesController, CostCodeTemplatesController],
  providers: [CostCodesService],
})
export class CostCodesModule {}
