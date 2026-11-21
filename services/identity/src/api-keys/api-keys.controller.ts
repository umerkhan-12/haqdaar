import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import { ApiScope } from '@haqdaar/shared';
import { z } from 'zod';
import { ApiKeysService } from './api-keys.service';

const CreateBody = z.object({
  name: z.string().trim().min(3).max(60),
  scopes: z.array(ApiScope).min(1),
});
const ExchangeBody = z.object({ apiKey: z.string().startsWith('hq_live_').max(80) });

@ApiTags('api-keys')
@Controller()
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @ApiBearerAuth()
  @Roles('admin')
  @Post('api-keys')
  create(@CurrentUser() admin: AuthUser, @ZBody(CreateBody) b: z.infer<typeof CreateBody>) {
    return this.keys.create(admin, b.name, b.scopes);
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Get('api-keys')
  list(@CurrentUser() admin: AuthUser) {
    return this.keys.list(admin);
  }

  @ApiBearerAuth()
  @Roles('admin')
  @Delete('api-keys/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.keys.revoke(admin, id);
  }

  /** Partners (banks, telcos) exchange their API key for a short-lived scoped token. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('auth/token')
  @HttpCode(200)
  exchange(@ZBody(ExchangeBody) b: z.infer<typeof ExchangeBody>) {
    return this.keys.exchange(b.apiKey);
  }
}
