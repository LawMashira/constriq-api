import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PartyType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

class ProjectContactDto {
  @IsEnum(PartyType)
  partyType: PartyType;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

class ProjectUserDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  roleId?: string;
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('project.read')
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.companyId);
  }

  @Post()
  @RequirePermissions('project.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.companyId, user.id, dto);
  }

  @Get(':projectId')
  @RequirePermissions('project.read')
  get(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.projects.get(user.companyId, projectId);
  }

  @Patch(':projectId')
  @RequirePermissions('project.update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.companyId, user.id, projectId, dto);
  }

  @Get(':projectId/team')
  @RequirePermissions('project.read')
  team(@CurrentUser() user: AuthUser, @Param('projectId') projectId: string) {
    return this.projects.listTeam(user.companyId, projectId);
  }

  @Post(':projectId/team')
  @RequirePermissions('project.update')
  addUser(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: ProjectUserDto,
  ) {
    return this.projects.addUser(user.companyId, projectId, dto.userId, dto.roleId);
  }

  @Post(':projectId/contacts')
  @RequirePermissions('project.update')
  addContact(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: ProjectContactDto,
  ) {
    return this.projects.addContact(user.companyId, projectId, dto);
  }
}
