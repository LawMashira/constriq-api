import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { syncIdentityCatalog } from './tenant-bootstrap';

@Injectable()
export class IdentityCatalogService implements OnModuleInit {
  private readonly logger = new Logger(IdentityCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await syncIdentityCatalog(this.prisma);
    this.logger.log('Permission catalog synchronized');
  }
}
