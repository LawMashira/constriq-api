import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { ForecastingController } from './forecasting.controller';
import { ForecastingService } from './forecasting.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [ForecastingController],
  providers: [ForecastingService],
})
export class ForecastingModule {}
