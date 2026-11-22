-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PROCESSING', 'NEEDS_INFO', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('relief_claim', 'complaint', 'scam_report');

-- CreateEnum
CREATE TYPE "Lane" AS ENUM ('AUTO_APPROVE', 'ASK_MORE', 'HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "cnic_enc" TEXT NOT NULL,
    "cnic_hash" TEXT NOT NULL,
    "phone_enc" TEXT,
    "district" TEXT,
    "payout_iban" TEXT,
    "payout_alias" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "lane" "Lane",
    "priority" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "amount" INTEGER,
    "assigned_to" UUID,
    "created_by" UUID NOT NULL,
    "on_behalf_of" UUID,
    "idempotency_key" TEXT NOT NULL,
    "rule_version_id" UUID,
    "payout_iban" TEXT,
    "payout_alias" TEXT,
    "district_snapshot" TEXT,
    "household_size" INTEGER,
    "name_normalized_snapshot" TEXT,
    "helper_id" UUID,
    "payout_key" TEXT,
    "extraction" JSONB,
    "document_check" JSONB,
    "escalated_at" TIMESTAMP(3),
    "escalation_reason" TEXT,
    "flags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly_findings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "signal_type" TEXT NOT NULL,
    "signal_key" TEXT NOT NULL,
    "evidence_case_ids" TEXT[],
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "observed_count" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anomaly_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "logic" JSONB NOT NULL,
    "clauses" JSONB NOT NULL,
    "amount" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "published_by" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "rule_version_id" UUID,
    "lane" "Lane" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION,
    "eligible" BOOLEAN,
    "clauses_hit" JSONB NOT NULL,
    "hard_flags" TEXT[],
    "explanation_ur" TEXT NOT NULL,
    "explanation_en" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "decided_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_settings" (
    "tenant_id" UUID NOT NULL,
    "wrong_approval" INTEGER NOT NULL,
    "human_review" INTEGER NOT NULL,
    "ask_more" INTEGER NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "event_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dataset_seed" INTEGER NOT NULL,
    "dataset_size" INTEGER NOT NULL,
    "costs" JSONB NOT NULL,
    "headline" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_tenant_id_name_normalized_idx" ON "persons"("tenant_id", "name_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "persons_tenant_id_cnic_hash_key" ON "persons"("tenant_id", "cnic_hash");

-- CreateIndex
CREATE UNIQUE INDEX "cases_idempotency_key_key" ON "cases"("idempotency_key");

-- CreateIndex
CREATE INDEX "cases_tenant_id_status_priority_idx" ON "cases"("tenant_id", "status", "priority");

-- CreateIndex
CREATE INDEX "cases_person_id_created_at_idx" ON "cases"("person_id", "created_at");

-- CreateIndex
CREATE INDEX "cases_tenant_id_payout_key_created_at_idx" ON "cases"("tenant_id", "payout_key", "created_at");

-- CreateIndex
CREATE INDEX "cases_tenant_id_helper_id_created_at_idx" ON "cases"("tenant_id", "helper_id", "created_at");

-- CreateIndex
CREATE INDEX "cases_tenant_id_district_snapshot_household_size_created_at_idx" ON "cases"("tenant_id", "district_snapshot", "household_size", "created_at");

-- CreateIndex
CREATE INDEX "cases_tenant_id_name_normalized_snapshot_created_at_idx" ON "cases"("tenant_id", "name_normalized_snapshot", "created_at");

-- CreateIndex
CREATE INDEX "anomaly_findings_tenant_id_signal_type_created_at_idx" ON "anomaly_findings"("tenant_id", "signal_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "anomaly_findings_case_id_signal_key_key" ON "anomaly_findings"("case_id", "signal_key");

-- CreateIndex
CREATE INDEX "case_events_case_id_at_idx" ON "case_events"("case_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "rule_versions_tenant_id_version_key" ON "rule_versions"("tenant_id", "version");

-- CreateIndex
CREATE INDEX "decisions_case_id_created_at_idx" ON "decisions"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_published_at_created_at_idx" ON "outbox"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "eval_runs_tenant_id_created_at_idx" ON "eval_runs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_findings" ADD CONSTRAINT "anomaly_findings_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

