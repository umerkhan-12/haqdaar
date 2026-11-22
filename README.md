# Haqdaar

> **PROTOTYPE ONLY — not an official government service.** All identity, payment, SMS and data services are simulated. No real personal data is used. Every person in it is synthetic.

**Coder's Cup '26 · Hagrid's Hackathon · The Last Mile: AI on Public Rails**

We help **a low-literacy widow** **claim her monthly relief payment** even though **she cannot read forms, has a weak phone signal, and keeps receiving fake "relief payment" messages that could steal her savings.**

_Knows when it doesn't know. Proves who's real._

**Live:** <https://172-198-74-124.sslip.io> (Azure, India South Central; app, Postgres and automatic HTTPS on one server). All 14 Judge Mode scenarios pass against it. Demo accounts work there, password `demo1234`.

| For judges                                             |                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| The brief, line by line, with status and where to look | [docs/COVERAGE.md](docs/COVERAGE.md)                                                  |
| The programme: rules, process, synthetic test people   | [docs/PROGRAM.md](docs/PROGRAM.md)                                                    |
| Hands-on test checklist for every feature              | [docs/TEST_REPORT.md](docs/TEST_REPORT.md)                                            |
| What is real, what is simulated, what the limits are   | [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md)                                |
| The 7-minute demo and prepared answers                 | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)                                            |
| Architecture and service contracts                     | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/CONTRACTS.md](docs/CONTRACTS.md) |
| Tests, fuzzing, findings                               | [docs/TESTING.md](docs/TESTING.md)                                                    |

## Try it in 2 minutes

Open the app and tap a demo account on the login page. Password for all of them: `demo1234`.

| Role                     | Phone                        | Try this                                                                                                                                                                                                             |
| ------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Citizen (Zainab)         | `03001110001`                | "Claim my money": tap the microphone and speak Urdu, or "Start with a photo of my CNIC" (use a [specimen card](docs/demo/specimen-cnic.md), never a real one). Then "Where is my money?" for the spoken Haq Receipt. |
| Helper (shopkeeper Asif) | `03001110002`                | Pick a family, enter its PIN (Zainab `1111`, Rashida `2222`, Nasreen `3333`), act for it, "Switch family".                                                                                                           |
| Officer (Sana, Kamran)   | `03001110003`, `03001110006` | Queue: sort by lowest confidence, open a case, read the AI notes, approve or escalate.                                                                                                                               |
| Admin (Hira)             | `03001110004`                | Rules (change a threshold, run the Digital Twin, publish), AI (Kill AI), Evaluation, **Judge Mode**.                                                                                                                 |
| Auditor (Bilal)          | `03001110005`                | Audit log: open a decision trace, "Verify chain".                                                                                                                                                                    |

Fastest tour: log in as Admin, open **Judge Mode**, press **Run** on any challenge. Each button drives the real system through the public API and prints every step.

## What makes it different

- **Haqdaar Seal.** Every genuine program message carries a signed code. "Real" is proven, not guessed; the AI only handles messages the seal and fixed rules cannot settle.
- **Haq Receipt.** At payout she hears the exact amount in Urdu on her own phone, so a middleman cannot quietly keep part of it.
- **The model never approves and automation never rejects.** A versioned rule engine decides. It approves alone only when `p ≥ 0.988`, a threshold derived from costs: `(1 − p) × 25,000 < 300`. Everything else goes to a person, with notes.
- **Judge Mode.** One button per challenge in the brief, five payment failures, and a switch that breaks the mock Raast rail live.
- **Honest about itself.** Property tests (115,560 generated cases) and a fuzz harness found real defects; the fixed ones and the open ones are both listed in [docs/TESTING.md](docs/TESTING.md).

## Features

Full table with status, screen and code path for every line of the brief: [docs/COVERAGE.md](docs/COVERAGE.md).

| Area       | What is there                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Citizen    | Voice claim in Urdu (asks only what is missing, reads back, yes / no), CNIC photo fills name and number, progress saved on the phone, status timeline, scam check, "My data and permission", self sign-up with a one-time SMS code and a 4-digit PIN                                                                                                                                                                                              |
| Helper     | Helper Mode: one phone, many families, a PIN and separate consent per family                                                                                                                                                                                                                                                                                                                                                                      |
| Officer    | Review queue (priority, confidence, waiting time), AI notes on every case, approve / reject / ask for info / assign / escalate / close, held payouts with a four-eyes rule                                                                                                                                                                                                                                                                        |
| Admin      | Rule editor + Digital Twin, cost model, AI profile and Kill AI, evaluation dashboard, Scam Map, team management (add staff, change role, disable), programs (tenants) with usage metering, API keys, webhooks, API docs, Judge Mode, mock phone                                                                                                                                                                                                   |
| Auditor    | Read-only hash-chained audit log, readable decision trace                                                                                                                                                                                                                                                                                                                                                                                         |
| Platform   | RS256 JWT + role checks in every service, consent enforced server-side, payment state machine, double-entry ledger, reconciliation, offline outbox, rate limiting                                                                                                                                                                                                                                                                                 |
| Also live  | "Ask about the program" by voice with sources (`/citizen/ask`) · fraud-ring signals for officers · read-only tool-calling assistant · Scam Map (`/admin/scams`) · Team and roles (`/admin/users`) · side navigation and full width for staff on wide screens                                                                                                                                                                                      |
| Last build | Sealed Haq Receipt with a QR code on the citizen's status screen · she corrects her name or CNIC by voice or typing when an officer asks · forgotten PIN by SMS code · a citizen links her own helper and chooses the family PIN · officers see "my information is wrong" requests · a held or failed payout can be sent to a corrected number, only if the account is in her name · plain message to the citizen when a payout is held or failed |

## AI features

| #   | Feature                                    | Model or tool                                                                                                                                                                                       | Safety rule around it                                                                                                                                                                                                                  |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Urdu speech to text                        | Groq Whisper `whisper-large-v3` (Gemini wired as an alternative, capped at USD 2, currently without credit)                                                                                         | Not understood twice → she types or a helper does. Never a loop, never a guess.                                                                                                                                                        |
| 2   | Claim extraction from speech               | Groq `openai/gpt-oss-120b`, Zod-validated, one repair attempt                                                                                                                                       | CNIC and phone removed before the prompt. The next question is picked by code. She confirms a read-back before sending.                                                                                                                |
| 3   | Urdu text to speech                        | 218 recorded prompts; `POST /ai/speak` (Microsoft `ur-PK-UzmaNeural` via `msedge-tts`, disk cache, circuit breaker); phone voice last                                                               | Speech only reads text the system already decided to show.                                                                                                                                                                             |
| 4   | CNIC photo checks                          | Tesseract OCR, `jsqr`, error-level analysis, EXIF, blur, all on our server                                                                                                                          | The image never goes to an outside model. A failed check never rejects: retake if blurry, otherwise an officer.                                                                                                                        |
| 5   | Scam classification                        | Seal (HMAC) → red-flag rules → LLM                                                                                                                                                                  | The LLM is asked only when the first two cannot settle it. Disagreement → "not sure".                                                                                                                                                  |
| 6   | Decision routing                           | Rule engine (JSON Logic) + calibrated confidence. No LLM.                                                                                                                                           | Three lanes: auto-approve, ask more, human review. Automation never rejects.                                                                                                                                                           |
| 7   | Structured outputs                         | Zod schemas, versioned task names                                                                                                                                                                   | A malformed answer counts as "not sure".                                                                                                                                                                                               |
| 8   | Guardrails + human approval                | PII redaction, caution-only AI notes, capped client confidence, Kill AI                                                                                                                             | What the phone reports can move a claim toward an officer, never toward approval. First claim of a new account always goes to an officer.                                                                                              |
| 9   | Explanations                               | Template from the rule clauses (Urdu + English); `POST /ai/explain` rewrites it for the ear                                                                                                         | The rewrite is dropped if it adds a number or contradicts the lane. The claim result and status screens call it and show the engine's own text if it fails.                                                                            |
| 10  | Evaluation dashboard                       | Engine run on a synthetic labelled set; live program numbers; AI call stats                                                                                                                         | False alarms shown next to wrong approvals. Golden-set gates in CI.                                                                                                                                                                    |
| 11  | Memory                                     | Claim draft kept on the phone for 24 hours; offline outbox                                                                                                                                          | On-device only.                                                                                                                                                                                                                        |
| 12  | RAG with sources ("Ask about the program") | `services/knowledge`: local lexical retrieval (light stemming, an English / Roman Urdu / Urdu concept table, BM25); no model call. Gemini embeddings are an optional path, unused today (no credit) | Answers are policy sentences word for word, each with its source. Refuses below a coverage threshold and on injection patterns. 47-question set: citation accuracy 1.000, refusal recall 1.000, tuned on that same set (not held-out). |
| 13  | Fraud-ring anomaly signals                 | SQL aggregates + a pure detector (`services/cases/src/engine/anomaly.ts`), no model. Officer card "Fraud-ring signals" and "Scan for fraud rings"; Judge Mode "Fraud ring signals"                  | Only adds a flag for an officer. The citizen hears the same sentence as for any not-sure claim, never which check fired.                                                                                                               |
| 14  | Read-only assistant (tool calling)         | `POST /ai/assist`: four fixed tools (`searchPolicy`, `getMyClaims`, `getMyPayments`, `checkMessage`), at most 3 calls, answers from templates; a keyword planner picks the tools when AI is off     | Read-only: it cannot approve, pay or edit. Tools run with the caller's own token, so she sees only her own data. Every call is audited as `ai.tool.called`.                                                                            |
| 15  | Scam Map                                   | Counts from audit events (`GET /audit/scam-map`), no model                                                                                                                                          | Message text is never stored, except a message the citizen chooses to show an officer (numbers masked).                                                                                                                                |

Why each model and tool was chosen: [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md#2-ai-models-and-tools-and-why-each-was-chosen).

## Architecture

Microservices behind a gateway, one Postgres schema per service, durable events through a transactional outbox + pg-boss. Every service verifies the user's token itself.

| Service      | Port | Owns                                                                                                                                |
| ------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `gateway`    | 4000 | Public entry: routing, Helmet, CORS allowlist, rate limit, `/status`, API docs for every service (`/docs/:service`), usage metering |
| `identity`   | 4001 | Programs (tenants), users, RS256 tokens + refresh rotation, sign-up, consent, Helper Mode, API keys                                 |
| `cases`      | 4002 | Claims, JSON Logic rules + versions, decision engine, officer queue, Digital Twin, evaluation                                       |
| `ai`         | 4003 | `AI_PROFILE` switch (dev / demo / offline), LLM + Urdu speech with fallback, vision, scam check, Kill AI                            |
| `payments`   | 4004 | Payout state machine, idempotency, title fetch, maker-checker, double-entry ledger, reconciliation, webhooks, Haq Receipt           |
| `audit`      | 4005 | Append-only hash-chained log of every event                                                                                         |
| `rails-mock` | 4006 | Simulated NADRA, Raast, household data, SMS, with fault injection                                                                   |
| `judge`      | 4007 | Judge Mode scenarios                                                                                                                |
| `knowledge`  | 4008 | Synthetic policy corpus, citation-grounded program answers (`POST /knowledge/ask`)                                                  |

```
apps/web            Next.js PWA (citizen, helper, officer, admin, auditor, Judge Mode)
services/*          NestJS (Fastify) microservices
packages/shared     Zod contracts, events, domain rules shared by web and services
packages/nest-kit   Shared toolkit: bootstrap, auth guards, errors, service client, circuit breaker, event bus, crypto, seal
infra/ deploy/      Local Postgres (docker compose), one-box deploy
scripts/            Key generation, run-all, e2e, chaos, load, fuzz, demo reset
docs/               Coverage, real vs simulated, demo script, architecture, contracts, testing, plan
```

**Stack:** TypeScript · NestJS 11 (Fastify) · Next.js · Zod · Prisma · PostgreSQL · pg-boss · Groq (Whisper, LLM) · Gemini · Tesseract.

## Setup

Requirements: Node 22+, pnpm 9, Docker.

```bash
pnpm install
pnpm keys          # creates .env with fresh RS256 keys and secrets
pnpm db:up         # local Postgres on :5433
pnpm db:generate && pnpm build
pnpm db:migrate && pnpm db:seed   # fresh database: applies services/*/prisma/migrations (prisma migrate deploy)
pnpm start         # all services (or `pnpm dev` for watch mode)
pnpm dev:web       # web app on http://localhost:3000
```

Check `http://localhost:4000/status`. API docs for every service: `http://localhost:4000/docs/<service>`.

**Database.** Every service has versioned migrations (`services/*/prisma/migrations/0001_init/migration.sql`). `pnpm db:migrate` builds a fresh database from them. `pnpm db:push` is still there for quick local iteration on a schema. A database that was created earlier with `db:push` is baselined once per service with `prisma migrate resolve --applied 0001_init`. The one-box deploy (`scripts/docker/all-in-one.mjs`) applies new tables and columns in place on boot and never drops data. On the live server Postgres runs next to the app, for latency; Supabase works as a drop-in through its session pooler by changing the database URLs (not used for the demo, because the free pooler's connection cap is below what nine services hold).

Add your own `GROQ_API_KEY` (and optionally a Gemini key) to `.env` for live AI. Without keys the system still runs: AI answers become "not sure" and cases go to people. Never commit `.env`.

**AI profile:** `AI_PROFILE=dev` (free Groq first), `demo` (paid Gemini first), `offline` (no outside AI). Admins can switch at runtime in Admin > AI.

## Testing

| Command                                   | What it proves                                                                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                               | Unit and property tests for every package and service (decision engine, state machine, seal, hash chain, name matching, PII redaction, AI fallback…)                                                                                                       |
| `pnpm fuzz --unit`                        | Property tests only: 46 properties × 2,500 generated cases (115,560 in total), without touching running services                                                                                                                                           |
| `pnpm fuzz`                               | About 1,000 generated, mostly hostile requests through a local gateway: no 5xx, role checks on every route, forged tokens refused, one case per idempotency key                                                                                            |
| `pnpm e2e`                                | End-to-end worst cases through the gateway: forged and expired tokens, refresh-token theft, brute force, injection, double-submit races, consent, Helper Mode PINs, Raast timeout after debit, mule account, maker-checker, seal, partner API, audit chain |
| `pnpm chaos`                              | Kills services mid-flow: rails down → human review; audit down → no event lost; payments down → paid once after restart; AI down → clean 503                                                                                                               |
| `pnpm load`                               | Concurrent load through the gateway: p50 / p95 / p99 and error rate per endpoint                                                                                                                                                                           |
| `pnpm --filter @haqdaar/cases eval:check` | Golden-set gates for the decision engine (also in CI): wrong auto-approvals ≤ 0.5%, calibration matches a refit                                                                                                                                            |
| `pnpm eval:ai`                            | Claim extraction and scam check on 50 synthetic transcripts and 40 messages; see [docs/EVAL_AI.md](docs/EVAL_AI.md)                                                                                                                                        |
| `pnpm audio`                              | Re-records the fixed Urdu prompts after a wording change                                                                                                                                                                                                   |
| `pnpm demo:reset`                         | Clears claims, payouts and consents for a fresh rehearsal (the audit log is never touched)                                                                                                                                                                 |

Checks run against the deployed site on the final build (sign-up to payout, all 14 Judge Mode buttons, 56 worst-case attempts, every AI feature, offline in a real browser) are in [docs/TESTING.md](docs/TESTING.md), Part C. The scripts are in [scripts/live](scripts/live) and can be rerun by anyone.

## Real vs simulated

**Real:** Urdu speech to text, LLM calls, Urdu voice, OCR, QR decoding, forgery heuristics, RS256 login and server-side permissions, PostgreSQL, the hash-chained audit log, the HMAC seal, the rule engine and its calibration, the payment state machine and ledger logic, offline sync.

**Simulated:** NADRA, Raast, the household registry, SMS, bank accounts, the "Sahara" program and its policy documents, and every person, CNIC and phone number.

**Limits we know about:** everything is measured on synthetic data; forgery checks are heuristics that route to a person; scam recall is measured on templated scams only. The full list is in [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md).

## What we did not build, and why

| Not built                                                 | Why                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscription plans                                        | Not built, by decision. Usage is metered per program and shown against a monthly quota (reported, not enforced). Paid plans are out of scope for a relief program prototype. |
| WhatsApp and email notifications                          | SMS itself is simulated, so there was no real channel to send through. In-app status and the mock SMS cover the flow.                                                        |
| More partner API routes                                   | One works (scam check with an API key). The `cases:status` scope exists but has no route yet.                                                                                |
| Complaint case from the Haq Receipt                       | The receipt tells the citizen what to do; no case is opened yet. (A doubtful scam message can be sent to an officer: "Show this message to an officer".)                     |
| Cash collection for people with no bank account or wallet | Out of scope. See "Next steps".                                                                                                                                              |
| Claim progress across devices                             | Saved on the phone only.                                                                                                                                                     |
| A second approver for rule publishing                     | Payouts have maker-checker; rule changes do not yet.                                                                                                                         |

We chose one task done deeply over many done thinly, as the brief asks.

## Next steps

- **Cash for people without a bank account or wallet.** They would collect cash through authorised agents, using the same Haq Receipt and Haqdaar Seal, so the amount is still spoken to them and the message is still provable. Not built; out of scope for this prototype.
- A held-out question set for "Ask about the program", and a measured run of the Gemini embedding path once there is credit.
- An anchor outside the system for the audit chain, so truncation of the newest entries is detectable.

## Submission

- Live demo: <https://172-198-74-124.sslip.io>
- Demo video (3 min, MacBook and iPhone side by side): <https://drive.google.com/file/d/14yLNcowxlreyBKbYJNVRSE9sAIgR44zu/view?usp=sharing> (also in the repository: [docs/demo/haqdaar-demo.mp4](docs/demo/haqdaar-demo.mp4))

## Team

| Person     | Owns                                                        |
| ---------- | ----------------------------------------------------------- |
| Umer       | Backend services, integration, security, payments, deploy   |
| Ali Malick | Voice and language (speech in and out, spoken explanations) |
| Ayan       | Knowledge (RAG), AI evaluation, fraud signals               |

Build plan and original design notes: [docs/PLAN.md](docs/PLAN.md).
