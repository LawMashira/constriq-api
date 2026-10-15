import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertSameCompany } from '../identity/tenant';

const LOCKED: ProjectStatus[] = [ProjectStatus.CLOSED, ProjectStatus.CANCELLED];

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    assertSameCompany(companyId, project.companyId);
    return project;
  }

  async getWritable(companyId: string, projectId: string) {
    const project = await this.get(companyId, projectId);
    if (LOCKED.includes(project.status)) {
      throw new BadRequestException('Closed or cancelled projects cannot be mutated');
    }
    return project;
  }
}
