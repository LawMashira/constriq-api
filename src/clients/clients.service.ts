import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EntityType } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string) {
    return this.prisma.client.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
  }

  async create(companyId: string, userId: string, dto: CreateClientDto) {
    const client = await this.prisma.client.create({
      data: { companyId, ...dto },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.CREATE,
      module: 'CLIENTS',
      entityType: EntityType.CLIENT,
      entityId: client.id,
      description: `Client ${client.name} created`,
    });
    return client;
  }

  async get(companyId: string, id: string) {
    const client = await this.prisma.client.findFirst({ where: { id, companyId } });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  async update(companyId: string, userId: string, id: string, dto: UpdateClientDto) {
    await this.get(companyId, id);
    const client = await this.prisma.client.update({
      where: { id },
      data: dto,
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UPDATE,
      module: 'CLIENTS',
      entityType: EntityType.CLIENT,
      entityId: client.id,
      description: `Client ${client.name} updated`,
    });
    return client;
  }

  listConsultants(companyId: string) {
    return this.prisma.consultant.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  }

  createConsultant(companyId: string, dto: CreateClientDto) {
    return this.prisma.consultant.create({ data: { companyId, ...dto } });
  }

  async updateConsultant(companyId: string, id: string, dto: UpdateClientDto) {
    const existing = await this.prisma.consultant.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException('Consultant not found');
    }
    return this.prisma.consultant.update({
      where: { id },
      data: dto,
    });
  }
}
