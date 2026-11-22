// Creates a service's schema and tables on first boot. Never touches a schema that already has tables
// (the audit log must never be reset). Later additive schema changes are applied in place by all-in-one.mjs.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const service = process.env.SERVICE;
const raw = process.env[`${service.toUpperCase()}_DATABASE_URL`];
if (!raw) throw new Error(`${service.toUpperCase()}_DATABASE_URL is not set`);

const url = new URL(raw);
const schema = url.searchParams.get('schema') ?? service;
url.searchParams.delete('schema');

const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  const { rows } = await client.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1', [schema]);
  if (rows[0].n > 0) {
    console.log(`db-init: schema "${schema}" already has ${rows[0].n} tables, nothing to do`);
  } else {
    await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(readFileSync('dist/schema.sql', 'utf8'));
    await client.query('COMMIT');
    console.log(`db-init: created schema "${schema}"`);
  }
} finally {
  await client.end();
}
