import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCostCodeDto } from './dto/create-cost-code.dto';

@Injectable()
export class CostCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  async list(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    return this.prisma.costCode.findMany({
      where: { projectId, companyId },
      orderBy: { code: 'asc' },
    });
  }

  async create(companyId: string, projectId: string, dto: CreateCostCodeDto) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.costCode.create({
      data: { companyId, projectId, ...dto },
    });
  }

  async update(companyId: string, projectId: string, id: string, dto: CreateCostCodeDto) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.costCode.update({
      where: { id },
      data: dto,
    });
  }

  listTemplates(companyId: string) {
    return this.prisma.costCodeTemplate.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  createTemplate(companyId: string, dto: CreateCostCodeDto) {
    return this.prisma.costCodeTemplate.create({ data: { companyId, ...dto } });
  }

  async applyTemplate(companyId: string, projectId: string, templateId: string) {
    await this.projects.getWritable(companyId, projectId);
    const template = await this.prisma.costCodeTemplate.findFirst({
      where: { id: templateId, companyId },
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return this.prisma.costCode.create({
      data: {
        companyId,
        projectId,
        templateId: template.id,
        code: template.code,
        name: template.name,
        category: template.category,
        description: template.description,
      },
    });
  }
}
