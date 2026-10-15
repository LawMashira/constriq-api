import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AssignRoleDto } from './dto/assign-role.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.manage')
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user.companyId);
  }

  @Get('roles')
  @RequirePermissions('users.manage')
  roles(@CurrentUser() user: AuthUser) {
    return this.users.listRoles(user.companyId);
  }

  @Post('invite')
  @RequirePermissions('users.manage')
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteUserDto) {
    return this.users.invite(user.companyId, user.id, dto);
  }

  @Patch(':id/role')
  @RequirePermissions('users.manage')
  assignRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.users.assignRole(user.companyId, user.id, id, dto.roleId);
  }
}
