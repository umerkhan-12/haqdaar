// Shared harness for the end-to-end suites: tiny test runner, HTTP client, demo accounts.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
export const jwt = createRequire(join(root, 'packages/nest-kit/package.json'))('jsonwebtoken');

export const GW = process.env.E2E_GATEWAY ?? 'http://localhost:4000';
export const PASSWORD = 'demo1234';
export const PHONES = {
  citizen: '03001110001',
  helper: '03001110002',
  officer: '03001110003',
  officer2: '03001110006',
  admin: '03001110004',
  auditor: '03001110005',
};
export const ZAINAB = '10000000-0000-4000-8000-000000000001';

// ---------- tiny test harness ----------
const results = [];
let section = '';
export function describe(name) {
  section = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}
export async function it(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ section, name, ok: true });
    console.log(`  \x1b[32mâœ”\x1b[0m ${name} \x1b[90m(${Date.now() - t} ms)\x1b[0m`);
  } catch (e) {
    results.push({ section, name, ok: false, error: e.message });
    console.log(`  \x1b[31mâœ– ${name}\x1b[0m\n    ${e.message}`);
  }
}
export function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
export function expectStatus(res, ...codes) {
  if (!codes.includes(res.status)) {
    throw new Error(`expected HTTP ${codes.join('/')}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
}

// ---------- HTTP helpers ----------
export async function api(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  const res = await fetch(`${GW}${path}`, {
    method,
    headers: h,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

const tokenCache = {};
export async function login(role) {
  if (tokenCache[role]) return tokenCache[role];
  const r = await api('POST', '/auth/login', { body: { phone: PHONES[role], password: PASSWORD } });
  expectStatus(r, 200);
  tokenCache[role] = r.body;
  return r.body;
}
export const token = async (role) => (await login(role)).accessToken;

const suites = [];
export function registerSuite(fn) {
  suites.push(fn);
}

export async function runAll() {
  const started = Date.now();
  for (const s of suites) await s();
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  - [${f.section}] ${f.name}: ${f.error}`);
    process.exitCode = 1;
  }
}