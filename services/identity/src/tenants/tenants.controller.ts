import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentPrincipal,
  CurrentUser,
  InternalOnly,
  Roles,
  ZBody,
  ZQuery,
  type AuthUser,
  type Principal,
} from '@haqdaar/nest-kit';
import { LaunchProgramRequest, UsageBatch } from '@haqdaar/shared';
import { z } from 'zod';
import { TenantsService } from './tenants.service';

const UsageQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** "Launch a program": platform admin only (checked in the service against the DB flag). */
  @Roles('admin')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  launch(
    @CurrentUser() user: AuthUser,
    @ZBody(LaunchProgramRequest) b: z.infer<typeof LaunchProgramRequest>,
  ) {
    return this.tenants.launch(user, b);
  }

  @Roles('admin')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tenants.list(user);
  }

  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.tenants.mine(user);
  }

  @Roles('admin')
  @Get(':id/usage')
  usage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZQuery(UsageQuery) q: z.infer<typeof UsageQuery>,
  ) {
    return this.tenants.usage(user, id, q.days);
  }
}

/** Gateway → identity usage flush. Not routed by the gateway (no `/internal` prefix there). */
@ApiTags('internal')
@ApiSecurity('internal')
@InternalOnly()
@Controller('internal/usage')
export class InternalUsageController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @HttpCode(200)
  record(@CurrentPrincipal() caller: Principal, @ZBody(UsageBatch) b: z.infer<typeof UsageBatch>) {
    if (caller.kind !== 'service' || caller.service !== 'gateway')
      throw new ForbiddenException('Gateway only');
    return this.tenants.record(b);
  }
}
