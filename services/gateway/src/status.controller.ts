import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@haqdaar/nest-kit';
import { serviceUrl } from '@haqdaar/shared';
import { DOCUMENTED as BACKENDS, docsPath } from './docs.controller';

/** One page that tells the judges (and UptimeRobot) whether the whole system is up. */
@ApiTags('status')
@Controller('status')
export class StatusController {
  @Public()
  @Get()
  async status() {
    const services = await Promise.all(
      BACKENDS.map(async (name) => {
        const started = Date.now();
        try {
          const res = await fetch(`${serviceUrl(name)}/health`, {
            signal: AbortSignal.timeout(2500),
          });
          const body = (await res.json()) as {
            status?: string;
            details?: { checks?: unknown };
            checks?: unknown;
          };
          return {
            name,
            ok: res.ok,
            status: res.ok ? body.status : 'degraded',
            ms: Date.now() - started,
            checks: body.checks ?? body.details?.checks,
          };
        } catch (e) {
          return {
            name,
            ok: false,
            status: 'down',
            ms: Date.now() - started,
            error: (e as Error).message,
          };
        }
      }),
    );
    return {
      status: services.every((s) => s.ok) ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      services,
      // Gateway-relative paths: the service ports are private on a deployed site.
      docs: Object.fromEntries(BACKENDS.map((s) => [s, docsPath(s)])),
    };
  }
}
