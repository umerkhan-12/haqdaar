#!/usr/bin/env node
// Press every Judge Mode button, like a judge would, and print the evidence.
// Usage: pnpm judge [rounds=1] [--reset]   (stack running with DEMO_MODE=1)
import { api, token } from './e2e-lib.mjs';

const rounds = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1);
const admin = await token('admin');

if (process.argv.includes('--reset')) {
  const r = await api('POST', '/judge/reset', { token: admin });
  console.log(`Reset: ${r.status} ${JSON.stringify(r.body?.services?.map((s) => `${s.service}:${s.ok}`))}`);
}

const list = await api('GET', '/judge/scenarios', { token: admin });
if (list.status !== 200) {
  console.error(`Judge Mode unavailable (HTTP ${list.status}). Is DEMO_MODE=1?`);
  process.exit(1);
}

let failures = 0;
for (let round = 1; round <= rounds; round++) {
  console.log(`\n\x1b[1mRound ${round}\x1b[0m`);
  for (const s of list.body) {
    const r = await api('POST', `/judge/scenarios/${s.id}/run`, { token: admin });
    const ok = r.status === 200 && r.body.ok;
    if (!ok) failures++;
    console.log(`${ok ? '\x1b[32m✔' : '\x1b[31m✖'}\x1b[0m [${s.challenge}] ${s.title} \x1b[90m(${r.body?.durationMs ?? '?'} ms)\x1b[0m`);
    console.log(`    ${r.body?.summary ?? JSON.stringify(r.body).slice(0, 300)}`);
    if (!ok) for (const step of r.body?.steps ?? []) console.log(`      ${step.ok ? '✓' : '✗'} ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
  }
}
console.log(`\n${failures === 0 ? 'All buttons passed' : `${failures} failed`} (${rounds} round${rounds > 1 ? 's' : ''})`);
process.exitCode = failures ? 1 : 0;
