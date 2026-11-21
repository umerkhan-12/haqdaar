#!/usr/bin/env node
// Chaos suite: kill services mid-flow and prove the system degrades safely and loses nothing.
// Usage: pnpm chaos   (resets demo state; stack must be running from built dist/)
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, describe, expect, expectStatus, it, registerSuite, runAll, token } from './e2e-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = { identity: 4001, cases: 4002, ai: 4003, payments: 4004, audit: 4005, 'rails-mock': 4006 };
const RASHIDA = '10000000-0000-4000-8000-000000000002';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const items = (b) => (Array.isArray(b) ? b : (b?.items ?? []));

function pidOnPort(port) {
  try {
    const cmd =
      process.platform === 'win32'
        ? `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop).OwningProcess"`
        : `lsof -ti tcp:${port} -sTCP:LISTEN`;
    return Number(execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\s+/)[0]) || null;
  } catch {
    return null;
  }
}

async function stop(name) {
  const pid = pidOnPort(PORTS[name]);
  if (pid) process.kill(pid);
  for (let i = 0; i < 30 && pidOnPort(PORTS[name]); i++) await sleep(200);
}

async function start(name) {
  const log = openSync(join(tmpdir(), `haqdaar-chaos-${name}.log`), 'a');
  spawn(process.execPath, ['dist/main.js'], {
    cwd: join(root, 'services', name),
    detached: true,
    stdio: ['ignore', log, log],
  }).unref();
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${PORTS[name]}/health`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`${name} did not come back`);
}

async function waitFor(fn, what, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out: ${what}`);
    await sleep(400);
  }
}

registerSuite(async () => {
  const helper = await token('helper');
  const act = await api('POST', '/auth/act-for', { token: helper, body: { personId: RASHIDA, pin: '2222' } });
  const rashida = act.body.accessToken;
  for (const purpose of ['identity_verification', 'household_data']) {
    await api('POST', '/consents', { token: rashida, body: { personId: RASHIDA, purpose } });
  }
  const claim = (key) =>
    api('POST', '/cases', {
      token: rashida,
      headers: { 'idempotency-key': key },
      body: {
        type: 'relief_claim',
        fullName: 'Rashida Begum',
        cnic: '42201-7654321-2',
        district: 'Karachi West',
        householdSize: 7,
        payout: { alias: '03001110007' },
      },
    });

  describe('Chaos: a dependency dies in the middle of the flow');

  await it('NADRA/Raast rails down → claim goes to a human (never guessed), gateway stays up', async () => {
    await stop('rails-mock');
    try {
      const r = await claim(`chaos-rails-${randomUUID()}`);
      expectStatus(r, 200, 201);
      expect(r.body.lane === 'HUMAN_REVIEW', `lane ${r.body.lane}`);
      const s = await api('GET', '/status');
      expect(s.body.services.find((x) => x.name === 'rails-mock').ok === false, 'status shows rails down');
    } finally {
      await start('rails-mock');
    }
  });

  await it('audit down while events happen → nothing lost: events are recorded after restart, chain valid', async () => {
    const auditor = await token('auditor');
    const before = (await api('GET', '/audit/stats', { token: auditor })).body.total;
    await stop('audit');
    await api('POST', '/auth/login', { body: { phone: '03001110005', password: 'demo1234' } });
    await api('POST', '/auth/login', { body: { phone: '03001110003', password: 'demo1234' } });
    await start('audit');
    await waitFor(async () => (await api('GET', '/audit/stats', { token: auditor })).body.total >= before + 2, 'queued events');
    const v = await api('POST', '/audit/verify-chain', { token: auditor, body: {} });
    expect(v.body.valid === true, JSON.stringify(v.body));
  });

  await it('payments down when a case is approved → payout happens after restart (durable event), exactly once', async () => {
    const officer = await token('officer');
    await stop('payments');
    let caseId;
    try {
      const r = await claim(`chaos-pay-${randomUUID()}`);
      caseId = r.body.id;
      if (r.body.status !== 'APPROVED') {
        expectStatus(await api('POST', `/cases/${caseId}/approve`, { token: officer, body: { note: 'chaos' } }), 200, 201);
      }
    } finally {
      await start('payments');
    }
    const paid = await waitFor(async () => {
      const ps = items((await api('GET', '/payments', { token: officer })).body).filter((p) => p.caseId === caseId);
      return ps.length && ps;
    }, 'payment created after restart');
    expect(paid.length === 1, `payments: ${paid.length}`);
  });

  await it('AI service down → gateway answers a clean 503; after restart scam checks work', async () => {
    await stop('ai');
    try {
      const r = await api('POST', '/ai/scam-check', { token: rashida, body: { text: 'Rs 500 fee bhejein' } });
      expectStatus(r, 503);
      expect(r.body.requestId && /unavailable/.test(r.body.message), JSON.stringify(r.body));
    } finally {
      await start('ai');
    }
    const r = await api('POST', '/ai/scam-check', { token: rashida, body: { text: 'Rs 500 fee bhejein aur PIN' } });
    expect(r.body.verdict === 'SCAM', `after restart: ${r.body.verdict}`);
  });
});

await runAll();
