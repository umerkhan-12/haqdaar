import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import { GATEWAY_ROUTES, serviceUrl } from '@haqdaar/shared';
import { INTERNAL_HEADER } from '@haqdaar/nest-kit';
import { env } from './env';

/**
 * Headers never forwarded upstream: internal credentials a client could try to inject,
 * and `expect: 100-continue` (sent by curl/PowerShell for bodies), which undici rejects.
 */
const STRIPPED = [INTERNAL_HEADER, 'x-forwarded-host', 'expect'];

/**
 * Edge concerns live here, business logic never does:
 * security headers, CORS allowlist, per-IP rate limit, routing by path prefix.
 * The gateway does NOT authenticate: every service verifies the JWT itself (zero trust).
 */
export async function configureEdge(app: NestFastifyApplication): Promise<void> {
  await app.register(helmet as never, {
    contentSecurityPolicy: false, // JSON API; the web app sets its own CSP
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors as never, {
    origin: env.corsOrigins,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  await app.register(rateLimit as never, {
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    allowList: (req: { url?: string }) => req.url === '/health',
  });

  for (const [prefix, service] of Object.entries(GATEWAY_ROUTES)) {
    await app.register(proxy as never, {
      upstream: serviceUrl(service),
      prefix,
      rewritePrefix: prefix,
      http2: false,
      replyOptions: {
        rewriteRequestHeaders: (
          req: { id: string; ip: string },
          headers: Record<string, string | string[] | undefined>,
        ) => {
          // Real client IP for per-user rate limits; any client-sent X-Forwarded-For is replaced.
          const out: Record<string, string | string[] | undefined> = {
            ...headers,
            'x-request-id': req.id,
            'x-forwarded-for': req.ip,
          };
          for (const h of STRIPPED) delete out[h];
          return out;
        },
      },
    });
  }
}
