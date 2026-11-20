import { Controller, Get, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators';
import { KIT_OPTIONS, type KitOptions } from './kit.options';

export type HealthCheck = () => Promise<Record<string, unknown> | void>;

/** Services register dependency checks (database, bus, upstream providers) here. */
@Injectable()
export class HealthRegistry {
  private readonly checks = new Map<string, { fn: HealthCheck; critical: boolean }>();

  register(name: string, fn: HealthCheck, critical = true): void {
    this.checks.set(name, { fn, critical });
  }

  async run() {
    const results: Record<string, { ok: boolean; ms: number; info?: unknown; error?: string }> = {};
    let healthy = true;
    await Promise.all(
      [...this.checks.entries()].map(async ([name, { fn, critical }]) => {
        const t = Date.now();
        try {
          const info = await Promise.race([
            fn(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
          ]);
          results[name] = { ok: true, ms: Date.now() - t, info: info ?? undefined };
        } catch (e) {
          results[name] = { ok: false, ms: Date.now() - t, error: (e as Error).message };
          if (critical) healthy = false;
        }
      }),
    );
    return { healthy, checks: results };
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly registry: HealthRegistry,
    @Inject(KIT_OPTIONS) private readonly opts: KitOptions,
  ) {}

  /** Liveness + dependency checks. 503 if a critical dependency is down. */
  @Public()
  @Get()
  async health() {
    const { healthy, checks } = await this.registry.run();
    const body = {
      service: this.opts.service,
      version: this.opts.version ?? '0.1.0',
      status: healthy ? 'ok' : 'degraded',
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      checks,
    };
    if (!healthy) throw new ServiceUnavailableException({ message: 'degraded', details: body });
    return body;
  }
}
