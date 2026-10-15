import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { syncIdentityCatalog } from './tenant-bootstrap';

@Injectable()
export class IdentityCatalogService implements OnModuleInit {
  private readonly logger = new Logger(IdentityCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const attempts = 8;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await syncIdentityCatalog(this.prisma);
        this.logger.log('Permission catalog synchronized');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Permission catalog sync failed (${attempt}/${attempts}): ${message}`);
        if (attempt === attempts) {
          this.logger.error(
            'Permission catalog sync skipped after retries; API will stay up so CORS and health checks work',
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }
}
