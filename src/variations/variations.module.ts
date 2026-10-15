import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { VariationsController } from './variations.controller';
import { VariationsService } from './variations.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [VariationsController],
  providers: [VariationsService],
})
export class VariationsModule {}
