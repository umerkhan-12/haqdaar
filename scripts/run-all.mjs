#!/usr/bin/env node
// Start every built service as a child process with prefixed logs.
// Used for the laptop backup on demo day and for single-machine runs. Build first: `pnpm build`.
// Ctrl+C stops everything. If one service crashes it is restarted (max 5 times a minute).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Order matters a little: audit first so it is subscribed before others publish.
const SERVICES = ['audit', 'identity', 'rails-mock', 'ai', 'cases', 'payments', 'judge', 'knowledge', 'gateway'];
const COLORS = [31, 32, 33, 34, 35, 36, 91, 92, 37];

const children = new Map();
const restarts = new Map();
let stopping = false;

function start(name, i) {
  const cwd = join(root, 'services', name);
  if (!existsSync(join(cwd, 'dist', 'main.js'))) {
    console.error(`[${name}] not built (run pnpm build)`);
    return;
  }
  const child = spawn(process.execPath, ['dist/main.js'], { cwd, env: { ...process.env, LOG_PRETTY: '' } });
  const tag = `\x1b[${COLORS[i]}m${name.padEnd(10)}\x1b[0m`;
  const pipe = (stream) =>
    stream.on('data', (d) =>
      d.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${tag} ${l}`)),
    );
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    children.delete(name);
    if (stopping) return;
    const now = Date.now();
    const recent = (restarts.get(name) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 5) {
      console.error(`${tag} crashed too often, giving up (exit ${code})`);
      return;
    }
    restarts.set(name, [...recent, now]);
    console.error(`${tag} exited (${code}), restarting in 1 s`);
    setTimeout(() => start(name, i), 1000);
  });
  children.set(name, child);
}

SERVICES.forEach((s, i) => setTimeout(() => start(s, i), i * 300));

function stop() {
  stopping = true;
  for (const c of children.values()) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
