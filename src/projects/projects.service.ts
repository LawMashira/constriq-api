import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EntityType, PartyType } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(companyId: string) {
    return this.prisma.project.findMany({
      where: { companyId },
      include: { client: true, health: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(companyId: string, userId: string, dto: CreateProjectDto) {
    const duplicate = await this.prisma.project.findUnique({
      where: { companyId_code: { companyId, code: dto.code } },
    });
    if (duplicate) {
      throw new ConflictException('Project code already exists');
    }
    if (dto.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: dto.clientId, companyId },
      });
      if (!client) {
        throw new NotFoundException('Client not found');
      }
    }

    const project = await this.prisma.project.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        clientId: dto.clientId,
        projectManagerId: dto.projectManagerId,
        siteAddress: dto.siteAddress,
        contractNo: dto.contractNo,
        projectType: dto.projectType,
        status: dto.status,
        contractStartDate: dto.contractStartDate ? new Date(dto.contractStartDate) : undefined,
        plannedCompletionDate: dto.plannedCompletionDate
          ? new Date(dto.plannedCompletionDate)
          : undefined,
        notes: dto.notes,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.CREATE,
      module: 'PROJECTS',
      entityType: EntityType.PROJECT,
      entityId: project.id,
      description: `Project ${project.code} created`,
    });
    return project;
  }

  async get(companyId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, companyId },
      include: {
        client: true,
        contracts: true,
        budget: true,
        health: true,
        contacts: true,
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async update(companyId: string, userId: string, id: string, dto: UpdateProjectDto) {
    await this.get(companyId, id);
    const project = await this.prisma.project.update({
      where: { id },
      data: {
        ...dto,
        contractStartDate: dto.contractStartDate ? new Date(dto.contractStartDate) : undefined,
        plannedCompletionDate: dto.plannedCompletionDate
          ? new Date(dto.plannedCompletionDate)
          : undefined,
      },
    });
    await this.audit.record({
      companyId,
      userId,
      action: AuditAction.UPDATE,
      module: 'PROJECTS',
      entityType: EntityType.PROJECT,
      entityId: id,
      description: 'Project updated',
      newData: dto as object,
    });
    return project;
  }

  async addContact(
    companyId: string,
    projectId: string,
    dto: { partyType: PartyType; name: string; email?: string; phone?: string; role?: string },
  ) {
    await this.get(companyId, projectId);
    return this.prisma.projectContact.create({
      data: { projectId, ...dto },
    });
  }

  async addUser(companyId: string, projectId: string, userId: string, roleId?: string) {
    await this.get(companyId, projectId);
    const membership = await this.prisma.companyMembership.findFirst({
      where: { companyId, userId },
    });
    if (!membership) {
      throw new NotFoundException('User is not a member of this company');
    }
    return this.prisma.projectUser.create({
      data: { projectId, userId, roleId },
    });
  }

  async listTeam(companyId: string, projectId: string) {
    await this.get(companyId, projectId);
    return this.prisma.projectUser.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true } }, role: true },
    });
  }
}
