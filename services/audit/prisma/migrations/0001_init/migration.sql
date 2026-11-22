-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "audit_log" (
    "seq" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tenant_id" TEXT,
    "actor_id" TEXT,
    "actor" JSONB,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_event_id_key" ON "audit_log"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_hash_key" ON "audit_log"("hash");

-- CreateIndex
CREATE INDEX "audit_log_entity_id_seq_idx" ON "audit_log"("entity_id", "seq");

-- CreateIndex
CREATE INDEX "audit_log_type_seq_idx" ON "audit_log"("type", "seq");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_seq_idx" ON "audit_log"("actor_id", "seq");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_seq_idx" ON "audit_log"("tenant_id", "seq");

-- CreateIndex
CREATE INDEX "audit_log_recorded_at_idx" ON "audit_log"("recorded_at");

