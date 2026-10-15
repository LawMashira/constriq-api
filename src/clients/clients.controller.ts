import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('consultants')
export class ConsultantsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions('client.read')
  list(@CurrentUser() user: AuthUser) {
    return this.clients.listConsultants(user.companyId);
  }

  @Post()
  @RequirePermissions('client.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.clients.createConsultant(user.companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions('client.update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.updateConsultant(user.companyId, id, dto);
  }
}

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermissions('client.read')
  list(@CurrentUser() user: AuthUser) {
    return this.clients.list(user.companyId);
  }

  @Post()
  @RequirePermissions('client.create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.clients.create(user.companyId, user.id, dto);
  }

  @Get(':id')
  @RequirePermissions('client.read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.clients.get(user.companyId, id);
  }

  @Patch(':id')
  @RequirePermissions('client.update')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(user.companyId, user.id, id, dto);
  }
}
