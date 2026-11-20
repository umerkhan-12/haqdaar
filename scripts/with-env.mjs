#!/usr/bin/env node
// Run a command with the monorepo root .env loaded (used for the Prisma CLI in each service).
// Usage: node ../../scripts/with-env.mjs prisma db push
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-env <command> [...args]');
  process.exit(1);
}
// One command string (args are our own fixed script arguments, never user input).
const child = spawn([cmd, ...args].join(' '), { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
