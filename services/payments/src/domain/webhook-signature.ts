import { hmacSha256, safeEqual } from '@haqdaar/nest-kit';

/** `x-haqdaar-signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>` (Stripe-style). */
export function signWebhook(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${hmacSha256(`${t}.${body}`, secret)}`;
}

/** Retry backoff for failed deliveries: 10 s, 20 s, 40 s, 80 s, 160 s. */
export const backoffMs = (attempts: number) => 10_000 * 2 ** Math.max(0, attempts - 1);

/** Receivers reject old timestamps (replay protection) and compare in constant time. */
export function verifyWebhook(
  header: string,
  body: string,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  return safeEqual(parts.v1, hmacSha256(`${t}.${body}`, secret));
}
