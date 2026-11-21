import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ServiceClient } from '@haqdaar/nest-kit';
import { GATEWAY_ROUTES, type UsageBatch } from '@haqdaar/shared';
import { env } from './env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bound on distinct (tenant, day, service) keys held between flushes. */
const MAX_KEYS = 10_000;

/**
 * Tenant id from the bearer token's `tid` claim, decoded WITHOUT verifying the signature.
 * Used for metering only, never for auth: every service still verifies the token itself.
 */
export function tenantFromAuth(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const payload = header.slice(7).split('.')[1];
  if (!payload) return null;
  try {
    const tid = (
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { tid?: unknown }
    ).tid;
    return typeof tid === 'string' && UUID.test(tid) ? tid.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The service a public path is routed to, by its first segment (same table the proxy uses). */
export function serviceFor(url: string): string | null {
  const first = `/${url.split(/[/?#]/)[1] ?? ''}`;
  return GATEWAY_ROUTES[first] ?? null;
}

/**
 * Counts requests per tenant, UTC day and service in memory and flushes them to identity
 * (`POST /internal/usage`) every 15 s. Counts are kept on a failed flush and merged into the next.
 * Trade-off: a gateway crash loses at most the last ~15 s of counts (metering, not billing-grade).
 */
@Injectable()
export class UsageMeter implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(UsageMeter.name);
  private counts = new Map<string, { requests: number; errors: number }>();
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(private readonly client: ServiceClient) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), env.USAGE_FLUSH_MS);
    this.timer.unref();
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  /**
   * Called once per response. 401s are not counted: a forged token carrying someone else's `tid`
   * is rejected by the service, so it cannot inflate that tenant's usage.
   */
  record(authorization: string | undefined, url: string, status: number, now = new Date()): void {
    if (status === 401) return;
    const tenantId = tenantFromAuth(authorization);
    const service = tenantId && serviceFor(url);
    if (!tenantId || !service) return;
    const key = `${tenantId}|${now.toISOString().slice(0, 10)}|${service}`;
    let c = this.counts.get(key);
    if (!c) {
      if (this.counts.size >= MAX_KEYS) return;
      c = { requests: 0, errors: 0 };
      this.counts.set(key, c);
    }
    c.requests += 1;
    if (status >= 500) c.errors += 1;
  }

  /** Swap the map out, send it; on failure merge it back so nothing is lost. */
  async flush(): Promise<void> {
    if (this.flushing || this.counts.size === 0) return;
    this.flushing = true;
    const batch = this.counts;
    this.counts = new Map();
    try {
      await this.client.call('identity', '/internal/usage', {
        method: 'POST',
        body: toBatch(batch),
        timeoutMs: 5000,
      });
    } catch (err) {
      this.logger.warn({ err: String(err), keys: batch.size }, 'Usage flush failed, will retry');
      for (const [k, v] of batch) {
        const c = this.counts.get(k);
        if (c) {
          c.requests += v.requests;
          c.errors += v.errors;
        } else if (this.counts.size < MAX_KEYS) this.counts.set(k, v);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** For tests and /status: what is waiting to be flushed. */
  pending(): UsageBatch {
    return toBatch(this.counts);
  }
}

function toBatch(counts: Map<string, { requests: number; errors: number }>): UsageBatch {
  return {
    entries: [...counts].map(([k, v]) => {
      const [tenantId, day, service] = k.split('|') as [string, string, string];
      return { tenantId, day, service, ...v };
    }),
  };
}
