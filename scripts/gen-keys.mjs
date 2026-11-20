#!/usr/bin/env node
// Creates .env from .env.example with fresh secrets: RS256 key pair, internal secret,
// PII encryption key, lookup-hash key, seal secret. Never overwrites an existing .env
// unless --force is given.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env already exists (use --force to regenerate secrets). Nothing changed.');
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');

const secrets = {
  JWT_PRIVATE_KEY: `"${oneLine(privateKey)}"`,
  JWT_PUBLIC_KEY: `"${oneLine(publicKey)}"`,
  INTERNAL_SECRET: randomBytes(32).toString('hex'),
  PII_ENC_KEY: randomBytes(32).toString('hex'),
  PII_HASH_KEY: randomBytes(32).toString('hex'),
  SEAL_SECRET: randomBytes(32).toString('hex'),
  WEBHOOK_SIGNING_SECRET: randomBytes(32).toString('hex'),
};

let text = readFileSync(join(root, '.env.example'), 'utf8');
for (const [k, v] of Object.entries(secrets)) {
  const re = new RegExp(`^${k}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text}\n${k}=${v}`;
}
writeFileSync(target, text);
console.log('Wrote .env with fresh secrets. Add your GROQ / GEMINI keys next.');
