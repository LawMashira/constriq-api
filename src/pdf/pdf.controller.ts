import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ProjectAccessService } from '../common/project-access.service';
import { PdfService } from './pdf.service';

@Controller('projects/:projectId/pdf')
export class PdfController {
  constructor(
    private readonly pdf: PdfService,
    private readonly projects: ProjectAccessService,
  ) {}

  @Get('profitability')
  @RequirePermissions('reports.read')
  async profitability(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    return this.send(user, projectId, 'profitability', response, () =>
      this.pdf.profitability(user.companyId, projectId),
    );
  }

  @Get('cost')
  @RequirePermissions('reports.read')
  async cost(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    return this.send(user, projectId, 'cost', response, () =>
      this.pdf.costs(user.companyId, projectId),
    );
  }

  @Get('variations')
  @RequirePermissions('reports.read')
  async variations(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    return this.send(user, projectId, 'variations', response, () =>
      this.pdf.variations(user.companyId, projectId),
    );
  }

  @Get('claims')
  @RequirePermissions('reports.read')
  async claims(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    return this.send(user, projectId, 'claims', response, () =>
      this.pdf.claims(user.companyId, projectId),
    );
  }

  @Get('cash-flow')
  @RequirePermissions('reports.read')
  async cashFlow(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    return this.send(user, projectId, 'cash-flow', response, () =>
      this.pdf.cashFlow(user.companyId, projectId),
    );
  }

  @Get('leakage')
  @RequirePermissions('reports.read')
  async leakage(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Res() response: Response,
  ) {
    return this.send(user, projectId, 'leakage', response, () =>
      this.pdf.leakage(user.companyId, projectId),
    );
  }

  private async send(
    user: AuthUser,
    projectId: string,
    name: string,
    response: Response,
    build: () => Promise<Buffer>,
  ) {
    const project = await this.projects.get(user.companyId, projectId);
    const buffer = await build();
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${project.code}-${name}.pdf"`);
    response.send(buffer);
  }
}
