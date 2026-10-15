import { Body, Controller, ForbiddenException, Get, Injectable, Module, Param, Patch } from '@nestjs/common';
import { CompanyStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class UpdateCompanyStatusDto {
  @IsEnum(CompanyStatus)
  status: CompanyStatus;
}

function isPlatformAdmin(email: string) {
  const allowed = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

@Injectable()
class AdministrationService {
  constructor(private readonly prisma: PrismaService) {}

  listCompanies() {
    return this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        legalName: true,
        tradingName: true,
        status: true,
        createdAt: true,
        _count: { select: { users: true, projects: true } },
      },
    });
  }

  updateStatus(id: string, status: CompanyStatus) {
    return this.prisma.company.update({ where: { id }, data: { status } });
  }
}

@Controller('admin')
class AdministrationController {
  constructor(private readonly admin: AdministrationService) {}

  @Get('companies')
  list(@CurrentUser() user: AuthUser) {
    assertPlatform(user);
    return this.admin.listCompanies();
  }

  @Patch('companies/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCompanyStatusDto) {
    assertPlatform(user);
    return this.admin.updateStatus(id, dto.status);
  }
}

function assertPlatform(user: AuthUser) {
  if (!isPlatformAdmin(user.email)) {
    throw new ForbiddenException('Platform administration is a separate boundary from company OWNER');
  }
}

@Module({
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
