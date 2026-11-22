-- One schema per service (database-per-service pattern on a single free Postgres).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;  -- only on pgvector images; skipped otherwise
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pgvector not available, skipping';
END $$;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS cases;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE SCHEMA IF NOT EXISTS pgboss;
