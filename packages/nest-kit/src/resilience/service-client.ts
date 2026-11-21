import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { serviceUrl, type ServiceName } from '@haqdaar/shared';
import { signInternalToken } from '../auth/tokens';
import { INTERNAL_HEADER } from '../auth/guards';
import { KIT_OPTIONS, type KitOptions } from '../kit.options';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Required for retrying non-GET calls safely. */
  idempotencyKey?: string;
  timeoutMs?: number;
  retries?: number;
  correlationId?: string;
}

type Outcome<T> = { ok: true; data: T } | { ok: false; error: HttpException };

/**
 * Service-to-service HTTP client:
 *  - signs a 60 s internal token for the target service
 *  - timeout per call, circuit breaker per target
 *  - retries with backoff ONLY when safe (GET or idempotency key present)
 *  - a 4xx answer is a healthy upstream saying "no": it never trips the breaker or retries
 */
@Injectable()
export class ServiceClient {
  private readonly logger = new Logger(ServiceClient.name);
  private readonly breakers = new Map<ServiceName, CircuitBreaker>();

  constructor(@Inject(KIT_OPTIONS) private readonly opts: KitOptions) {}

  breaker(target: ServiceName): CircuitBreaker {
    let b = this.breakers.get(target);
    if (!b) {
      b = new CircuitBreaker(target, { failureThreshold: 5, resetAfterMs: 10_000 });
      this.breakers.set(target, b);
    }
    return b;
  }

  async call<T>(target: ServiceName, path: string, o: CallOptions = {}): Promise<T> {
    const method = o.method ?? 'GET';
    const safeToRetry = method === 'GET' || !!o.idempotencyKey;
    const retries = safeToRetry ? (o.retries ?? 2) : 0;
    const url = `${serviceUrl(target)}${path}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const outcome = await this.breaker(target).exec(() => this.once<T>(target, url, method, o));
        if (outcome.ok) return outcome.data;
        throw outcome.error; // 4xx: final answer
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() < 500) throw e;
        lastError = e;
        if (e instanceof CircuitOpenError) break;
        if (attempt < retries) await sleep(150 * 2 ** attempt);
      }
    }
    this.logger.warn({ target, path, err: String(lastError) }, 'Upstream call failed');
    throw new ServiceUnavailableException(`${target} is unavailable`);
  }

  /** Resolves for 2xx and 4xx; rejects (counts as failure) for 5xx, timeouts, network errors. */
  private async once<T>(
    target: ServiceName,
    url: string,
    method: string,
    o: CallOptions,
  ): Promise<Outcome<T>> {
    const headers: Record<string, string> = {
      [INTERNAL_HEADER]: signInternalToken(this.opts.service, target, this.opts.internalSecret),
      accept: 'application/json',
    };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.idempotencyKey) headers['idempotency-key'] = o.idempotencyKey;
    if (o.correlationId) headers['x-request-id'] = o.correlationId;

    const res = await fetch(url, {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 3000),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (res.ok) return { ok: true, data: data as T };

    const message = (data as { message?: string } | undefined)?.message ?? res.statusText;
    const error = new HttpException({ message, details: { upstream: target } }, res.status);
    if (res.status < 500) return { ok: false, error };
    throw error;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
