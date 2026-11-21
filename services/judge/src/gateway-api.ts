import { randomUUID } from 'node:crypto';
import { serviceUrl } from '@haqdaar/shared';
import { ACCOUNTS, type DemoRole, type Family } from './demo-data';

export interface ApiResult<T = any> {
  status: number;
  body: T;
  ms: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Judge Mode talks to the system exactly like a phone does: over the public gateway,
 * logged in as the demo accounts. Nothing is called behind the API's back.
 */
export class GatewayApi {
  private readonly base = serviceUrl('gateway');
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly password: string) {}

  async call<T = any>(
    method: string,
    path: string,
    o: {
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...o.headers };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const t = performance.now();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { status: res.status, body: body as T, ms: Math.round(performance.now() - t) };
  }

  /** Access token for a demo role, cached until shortly before it expires. */
  async as(role: DemoRole): Promise<string> {
    return this.cached(`role:${role}`, async () => {
      const r = await this.call('POST', '/auth/login', {
        body: { phone: ACCOUNTS[role], password: this.password },
      });
      if (r.status !== 200) throw new Error(`Demo login failed for ${role} (HTTP ${r.status})`);
      return r.body;
    });
  }

  /** Helper Mode: the shopkeeper switches to a family with that family's PIN. */
  async family(f: Family): Promise<string> {
    return this.cached(`family:${f.personId}`, async () => {
      const r = await this.call('POST', '/auth/act-for', {
        token: await this.as('helper'),
        body: { personId: f.personId, pin: f.pin },
      });
      if (r.status !== 200)
        throw new Error(`Helper could not switch to ${f.fullName} (HTTP ${r.status})`);
      return r.body;
    });
  }

  forget(): void {
    this.tokens.clear();
  }

  newIdempotencyKey(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  private async cached(
    key: string,
    fetchPair: () => Promise<{ accessToken: string; expiresIn: number }>,
  ) {
    const hit = this.tokens.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.token;
    const pair = await fetchPair();
    this.tokens.set(key, {
      token: pair.accessToken,
      expiresAt: Date.now() + (pair.expiresIn - 60) * 1000,
    });
    return pair.accessToken;
  }
}
