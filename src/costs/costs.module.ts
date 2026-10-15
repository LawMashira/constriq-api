import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [CostsController],
  providers: [CostsService],
})
export class CostsModule {}
