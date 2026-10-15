import { Global, Module } from '@nestjs/common';
import { FileStorageService } from '../storage/file-storage.service';
import { AuditService } from './audit.service';
import { ProjectAccessService } from './project-access.service';
import { SequenceService } from './sequence.service';

@Global()
@Module({
  providers: [AuditService, ProjectAccessService, SequenceService, FileStorageService],
  exports: [AuditService, ProjectAccessService, SequenceService, FileStorageService],
})
export class CommonModule {}
