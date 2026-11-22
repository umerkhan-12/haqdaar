import { Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { TEAM_ROLES } from './user-policy';
import { UsersService } from './users.service';

/** Body of `POST /users`. Phone must be a Pakistani mobile: it is the login name. */
export const CreateUserBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .max(20)
    .refine(
      (p) => /^(\+?92|0)3\d{9}$/.test(p.replace(/[\s-]/g, '')),
      'Not a Pakistani mobile number (03XXXXXXXXX)',
    ),
  role: z.enum(TEAM_ROLES),
});

/** Body of `PATCH /users/:id`: at least one of role / active. Strict so typos are not ignored. */
export const UpdateUserBody = z
  .object({ role: z.enum(TEAM_ROLES).optional(), active: z.boolean().optional() })
  .strict()
  .refine((b) => b.role !== undefined || b.active !== undefined, 'Send role and/or active');

/** Admin-only team management, always inside the admin's own tenant (see UsersService). */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles('admin')
  @Get()
  list(@CurrentUser() admin: AuthUser) {
    return this.users.list(admin);
  }

  @Roles('admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() admin: AuthUser, @ZBody(CreateUserBody) b: z.infer<typeof CreateUserBody>) {
    return this.users.create(admin, b);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(UpdateUserBody) b: z.infer<typeof UpdateUserBody>,
  ) {
    return this.users.update(admin, id, b);
  }
}
