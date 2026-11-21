#!/usr/bin/env node
// Quick load test through the gateway: N concurrent virtual users for D seconds per endpoint.
// Usage: pnpm load [concurrency=50] [seconds=8]
import { api, login, token } from './e2e-lib.mjs';

const CONCURRENCY = Number(process.argv[2] ?? 50);
const SECONDS = Number(process.argv[3] ?? 8);

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function scenario(name, call) {
  const latencies = [];
  let errors = 0;
  const statuses = {};
  const until = Date.now() + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < until) {
        const t = performance.now();
        const r = await call().catch(() => ({ status: 0 }));
        latencies.push(performance.now() - t);
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
        if (r.status === 0 || r.status >= 500) errors++;
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const row = {
    endpoint: name,
    rps: Math.round(latencies.length / SECONDS),
    p50: pct(latencies, 50).toFixed(1),
    p95: pct(latencies, 95).toFixed(1),
    p99: pct(latencies, 99).toFixed(1),
    errors,
    statuses: JSON.stringify(statuses),
  };
  console.log(row);
  return row;
}

const officer = await token('officer');
const citizen = await token('citizen');
const auditor = await token('auditor');
await login('admin');

console.log(`Load: ${CONCURRENCY} concurrent users × ${SECONDS}s per endpoint, through the gateway\n`);
const rows = [];
rows.push(await scenario('GET /auth/me', () => api('GET', '/auth/me', { token: citizen })));
rows.push(await scenario('GET /queue (officer)', () => api('GET', '/queue', { token: officer })));
rows.push(await scenario('GET /cases (citizen)', () => api('GET', '/cases', { token: citizen })));
rows.push(
  await scenario('POST /ai/scam-check (rules + cache)', () =>
    api('POST', '/ai/scam-check', {
      token: citizen,
      body: { text: 'Rs 500 fee jama karayen aur PIN bhejein, BISP inaam' },
    }),
  ),
);
rows.push(await scenario('GET /payments (officer)', () => api('GET', '/payments', { token: officer })));
rows.push(await scenario('GET /audit (auditor)', () => api('GET', '/audit?limit=20', { token: auditor })));
console.table(rows);
