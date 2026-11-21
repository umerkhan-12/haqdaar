#!/usr/bin/env node
// Reset demo state between rehearsals: removes claims and payouts, keeps people, rules, accounts.
// The audit log is append-only and is NEVER touched (the hash chain stays valid).
// Usage: pnpm demo:reset
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const { Client } = createRequire(join(root, 'packages/nest-kit/package.json'))('pg');

const CLEAR = {
  // Consents are demo state too: each rehearsal starts with the citizen not having shared anything.
  identity: ['consents'],
  cases: ['decisions', 'case_events', 'cases', 'processed_events', 'outbox'],
  payments: [
    'webhook_deliveries',
    'approvals',
    'ledger_entries',
    'payment_attempts',
    'payment_transitions',
    'payments',
    'reconciliation_runs',
    'outbox',
  ],
};

const url = new URL(process.env.BUS_DATABASE_URL);
const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query('BEGIN');
  for (const [schema, tables] of Object.entries(CLEAR)) {
    const { rows } = await client.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
      [schema],
    );
    const present = new Set(rows.map((r) => r.table_name));
    const list = tables.filter((t) => present.has(t)).map((t) => `"${schema}"."${t}"`);
    if (list.length) await client.query(`TRUNCATE ${list.join(', ')} CASCADE`);
    console.log(`${schema}: cleared ${list.length} tables`);
  }
  // Keep only the seeded rule v1 live; drafts from rehearsals are removed.
  await client.query(`DELETE FROM cases.rule_versions WHERE version > 1`);
  await client.query(`UPDATE cases.rule_versions SET status = 'PUBLISHED' WHERE version = 1`);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}

// Clear injected faults on the mock rails (best effort: service may be down).
const gw = process.env.GATEWAY_URL ?? 'http://localhost:4000';
try {
  const login = await fetch(`${gw}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '03001110004', password: 'demo1234' }),
  }).then((r) => r.json());
  await fetch(`${gw}/mock/faults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` },
    body: JSON.stringify({ raast: { mode: 'none', remaining: 0 } }),
  });
  console.log('rails-mock: faults cleared');
} catch {
  console.log('rails-mock: not reachable, faults not cleared');
}
console.log('Demo state reset. Audit log untouched.');
