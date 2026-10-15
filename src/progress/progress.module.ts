import { Body, Controller, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { IsQuantity } from '../common/dto/money-field';
import { rate } from '../common/money';
import { ProjectAccessService } from '../common/project-access.service';
import { PrismaService } from '../prisma/prisma.service';

class WorkPackageDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;
}

class ActivityDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  workPackageId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class MilestoneDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsDateString()
  plannedDate?: string;
}

class ProgressDto {
  @IsDateString()
  progressDate: string;

  @IsQuantity()
  plannedPercentage: string;

  @IsQuantity()
  actualPercentage: string;

  @IsOptional()
  @IsString()
  boqItemId?: string;

  @IsOptional()
  @IsString()
  costCodeId?: string;

  @IsOptional()
  @IsString()
  workPackageId?: string;

  @IsOptional()
  @IsString()
  activityId?: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;

  @IsOptional()
  @IsQuantity()
  quantityCompleted?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Injectable()
class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectAccessService,
  ) {}

  async overview(companyId: string, projectId: string) {
    await this.projects.get(companyId, projectId);
    const [workPackages, activities, milestones, records] = await Promise.all([
      this.prisma.workPackage.findMany({ where: { projectId } }),
      this.prisma.activity.findMany({ where: { projectId } }),
      this.prisma.milestone.findMany({ where: { projectId } }),
      this.prisma.progressRecord.findMany({ where: { projectId }, orderBy: { progressDate: 'desc' } }),
    ]);
    return { workPackages, activities, milestones, records };
  }

  async createPackage(companyId: string, projectId: string, dto: WorkPackageDto) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.workPackage.create({ data: { projectId, ...dto } });
  }

  async createActivity(companyId: string, projectId: string, dto: ActivityDto) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.activity.create({ data: { projectId, ...dto } });
  }

  async createMilestone(companyId: string, projectId: string, dto: MilestoneDto) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.milestone.create({
      data: {
        projectId,
        name: dto.name,
        plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
      },
    });
  }

  async completeMilestone(companyId: string, projectId: string, milestoneId: string) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.milestone.update({
      where: { id: milestoneId },
      data: { actualDate: new Date() },
    });
  }

  async recordProgress(companyId: string, projectId: string, dto: ProgressDto) {
    await this.projects.getWritable(companyId, projectId);
    return this.prisma.progressRecord.create({
      data: {
        projectId,
        progressDate: new Date(dto.progressDate),
        plannedPercentage: rate(dto.plannedPercentage),
        actualPercentage: rate(dto.actualPercentage),
        boqItemId: dto.boqItemId,
        costCodeId: dto.costCodeId,
        workPackageId: dto.workPackageId,
        activityId: dto.activityId,
        milestoneId: dto.milestoneId,
        quantityCompleted: dto.quantityCompleted ? rate(dto.quantityCompleted) : undefined,
        notes: dto.notes,
      },
    });
  }
}

@Controller('projects/:projectId/progress')
class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  @RequirePermissions('project.read')
  overview(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.progress.overview(user.companyId, projectId);
  }

  @Post('work-packages')
  @RequirePermissions('cost.create')
  workPackage(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: WorkPackageDto,
  ) {
    return this.progress.createPackage(user.companyId, projectId, dto);
  }

  @Post('activities')
  @RequirePermissions('cost.create')
  activity(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Body() dto: ActivityDto) {
    return this.progress.createActivity(user.companyId, projectId, dto);
  }

  @Post('milestones')
  @RequirePermissions('cost.create')
  milestone(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Body() dto: MilestoneDto) {
    return this.progress.createMilestone(user.companyId, projectId, dto);
  }

  @Patch('milestones/:milestoneId/complete')
  @RequirePermissions('cost.create')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.progress.completeMilestone(user.companyId, projectId, milestoneId);
  }

  @Post('records')
  @RequirePermissions('cost.create')
  record(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string, @Body() dto: ProgressDto) {
    return this.progress.recordProgress(user.companyId, projectId, dto);
  }
}

@Module({
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
