import { Controller, ForbiddenException, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly, type Principal } from './auth/decorators';
import { isDemoMode } from './config';
import type { ServiceClient } from './resilience/service-client';

/**
 * Demo reset and the AI switches act on every program at once, so a program's own admin may not use
 * them. The platform-admin flag lives only in identity's database and is asked for on every call.
 */
export async function requirePlatformAdmin(
  client: ServiceClient,
  principal: Principal | undefined,
  what: string,
): Promise<void> {
  const forbidden = new ForbiddenException(`${what} affects every program: platform admins only`);
  if (principal?.kind !== 'user' || principal.role !== 'admin') throw forbidden;
  const r = await client.call<{ platformAdmin: boolean }>(
    'identity',
    `/tenants/platform-admins/${principal.id}`,
  );
  if (!r.platformAdmin) throw forbidden;
}

/** Implemented by each service that owns demo state: clear it, keep reference data. */
export abstract class DemoResetter {
  abstract reset(): Promise<Record<string, number | string>>;
}

/**
 * `POST /internal/demo/reset` — internal only, and 404 unless DEMO_MODE=1.
 * Each service clears only its own schema (schema ownership is never broken for a demo).
 */
@ApiExcludeController()
@Controller('internal/demo')
export class DemoResetController {
  constructor(private readonly resetter: DemoResetter) {}

  @InternalOnly()
  @Post('reset')
  @HttpCode(200)
  reset() {
    if (!isDemoMode()) throw new NotFoundException();
    return this.resetter.reset();
  }
}
