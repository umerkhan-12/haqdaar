#!/usr/bin/env node
// Single-container start: every service on its default localhost port, the web app on PUBLIC_PORT
// (its /api/* is forwarded to the gateway). Used for one-box hosting (VPS, Hugging Face Spaces).
// Needs DATABASE_URL; each service gets its own schema in it. Tables and demo data on first boot.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = '/app';
const DB_SERVICES = ['identity', 'cases', 'payments', 'audit'];
const publicPort = process.env.PUBLIC_PORT ?? process.env.PORT ?? '7860';

const base = process.env.DATABASE_URL;
if (!base) throw new Error('DATABASE_URL is required');
const env = { ...process.env, LOG_PRETTY: '', BUS_DATABASE_URL: process.env.BUS_DATABASE_URL ?? base };
delete env.PORT; // each service listens on its own default port
for (const s of DB_SERVICES) {
  env[`${s.toUpperCase()}_DATABASE_URL`] ??= `${base}${base.includes('?') ? '&' : '?'}schema=${s}`;
}

for (const s of DB_SERVICES) {
  const cwd = join(root, 'services', s);
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { cwd, env: { ...env, SERVICE: s }, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${s}: ${args.join(' ')} failed`);
  };
  run([join(root, 'scripts/docker/db-init.mjs')]);
  if (env.DEMO_MODE === '1' && ['identity', 'cases'].includes(s)) run(['dist/seed.js']);
}

const procs = [
  spawn(process.execPath, [join(root, 'scripts/run-all.mjs')], { env, stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'apps/web/node_modules/next/dist/bin/next'), 'start', '-p', publicPort, '-H', '0.0.0.0'], {
    cwd: join(root, 'apps/web'),
    env: { ...env, NODE_ENV: 'production' },
    stdio: 'inherit',
  }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
procs.forEach((p) => p.on('exit', (code) => { console.error(`child exited (${code}), stopping`); stop(); process.exit(code ?? 1); }));
