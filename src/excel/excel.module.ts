import { Module } from '@nestjs/common';
import { ProfitEngineModule } from '../profit-engine/profit-engine.module';
import { FileStorageService } from '../storage/file-storage.service';
import { ExcelController } from './excel.controller';
import { ExcelService } from './excel.service';

@Module({
  imports: [ProfitEngineModule],
  controllers: [ExcelController],
  providers: [ExcelService, FileStorageService],
  exports: [ExcelService, FileStorageService],
})
export class ExcelModule {}
