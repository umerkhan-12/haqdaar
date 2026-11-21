import { Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import {
  LoginRequest,
  RefreshRequest,
  SignupStartRequest,
  SignupVerifyRequest,
} from '@haqdaar/shared';
import { z } from 'zod';

const ActForBody = z.object({ personId: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) });
import { AuthService } from './auth.service';
import { env } from '../env';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 10 attempts per minute per (IP, phone), plus a per-account lock after 5 failures. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(
    @ZBody(LoginRequest) body: z.infer<typeof LoginRequest>,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.login(body.phone, body.password, ua);
  }

  /** Citizen self sign-up, step 1. 3 codes per minute per (IP, phone); always answers { sent: true }. */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('signup/start')
  @HttpCode(200)
  signupStart(@ZBody(SignupStartRequest) body: z.infer<typeof SignupStartRequest>) {
    return this.auth.signupStart(body.phone);
  }

  /** Step 2: code + name + 4-digit PIN → a citizen account and the same token pair as login. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup/verify')
  @HttpCode(201)
  signupVerify(
    @ZBody(SignupVerifyRequest) body: z.infer<typeof SignupVerifyRequest>,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.signupVerify(body, ua);
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

  @ApiBearerAuth()
  @Roles('helper')
  @Get('families')
  families(@CurrentUser() user: AuthUser) {
    return this.auth.families(user);
  }

  @ApiBearerAuth()
  @Roles('helper')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('act-for')
  @HttpCode(200)
  actFor(
    @CurrentUser() user: AuthUser,
    @ZBody(ActForBody) body: z.infer<typeof ActForBody>,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.actFor(user, body.personId, body.pin, ua);
  }

  /** Public key so any service (or partner) can verify our tokens. Never the private key. */
  @Public()
  @Get('public-key')
  publicKey() {
    return { alg: 'RS256', issuer: 'haqdaar-identity', publicKey: env.JWT_PUBLIC_KEY };
  }
}
