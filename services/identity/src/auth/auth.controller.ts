import { Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import { LoginRequest, RefreshRequest } from '@haqdaar/shared';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { env } from '../env';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 5 attempts per minute per IP, plus a per-account lock after 5 failures. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(
    @ZBody(LoginRequest) body: z.infer<typeof LoginRequest>,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.login(body.phone, body.password, ua);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @ZBody(RefreshRequest) body: z.infer<typeof RefreshRequest>,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.refresh(body.refreshToken, ua);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@ZBody(RefreshRequest) body: z.infer<typeof RefreshRequest>) {
    await this.auth.logout(body.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** Public key so any service (or partner) can verify our tokens. Never the private key. */
  @Public()
  @Get('public-key')
  publicKey() {
    return { alg: 'RS256', issuer: 'haqdaar-identity', publicKey: env.JWT_PUBLIC_KEY };
  }
}
