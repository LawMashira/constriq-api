import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [PdfController],
  providers: [PdfService],
})
export class PdfModule {}
