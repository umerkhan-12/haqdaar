# Haqdaar

> **PROTOTYPE ONLY — not an official government service.** All identity, payment, SMS and data services are simulated. No real personal data is used. Every person in it is synthetic.

**Coder's Cup '26 · Hagrid's Hackathon · The Last Mile: AI on Public Rails**

We help **a low-literacy widow** **claim her monthly relief payment** even though **she cannot read forms, has a weak phone signal, and keeps receiving fake "relief payment" messages that could steal her savings.**

_Knows when it doesn't know. Proves who's real._

**Live:** <https://172-198-74-124.sslip.io> (Azure, India South Central)

| For judges | |
| --- | --- |
| The brief, line by line, with status and where to look | [docs/COVERAGE.md](docs/COVERAGE.md) |
| What is real, what is simulated, what the limits are | [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md) |
| The 7-minute demo and prepared answers | [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) |
| Architecture and service contracts | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/CONTRACTS.md](docs/CONTRACTS.md) |
| Tests, fuzzing, findings | [docs/TESTING.md](docs/TESTING.md) |

## Try it in 2 minutes

Open the app and tap a demo account on the login page. Password for all of them: `demo1234`.

| Role | Phone | Try this |
| ---- | ----- | -------- |
| Citizen (Zainab) | `03001110001` | "Claim my money": tap the microphone and speak Urdu, or "Start with a photo of my CNIC" (use a [specimen card](docs/demo/specimen-cnic.md), never a real one). Then "Where is my money?" for the spoken Haq Receipt. |
| Helper (shopkeeper Asif) | `03001110002` | Pick a family, enter its PIN (Zainab `1111`, Rashida `2222`, Nasreen `3333`), act for it, "Switch family". |
| Officer (Sana, Kamran) | `03001110003`, `03001110006` | Queue: sort by lowest confidence, open a case, read the AI notes, approve or escalate. |
| Admin (Hira) | `03001110004` | Rules (change a threshold, run the Digital Twin, publish), AI (Kill AI), Evaluation, **Judge Mode**. |
| Auditor (Bilal) | `03001110005` | Audit log: open a decision trace, "Verify chain". |

Fastest tour: log in as Admin, open **Judge Mode**, press **Run** on any challenge. Each button drives the real system through the public API and prints every step.

## What makes it different

- **Haqdaar Seal.** Every genuine program message carries a signed code. "Real" is proven, not guessed; the AI only handles messages the seal and fixed rules cannot settle.
- **Haq Receipt.** At payout she hears the exact amount in Urdu on her own phone, so a middleman cannot quietly keep part of it.
- **The model never approves and automation never rejects.** A versioned rule engine decides. It approves alone only when `p ≥ 0.988`, a threshold derived from costs: `(1 − p) × 25,000 < 300`. Everything else goes to a person, with notes.
- **Judge Mode.** One button per challenge in the brief, five payment failures, and a switch that breaks the mock Raast rail live.
- **Honest about itself.** Property tests (115,560 generated cases) and a fuzz harness found real defects; the fixed ones and the open ones are both listed in [docs/TESTING.md](docs/TESTING.md).

## Features

Full table with status, screen and code path for every line of the brief: [docs/COVERAGE.md](docs/COVERAGE.md).

| Area | What is there |
| ---- | ------------- |
| Citizen | Voice claim in Urdu (asks only what is missing, reads back, yes / no), CNIC photo fills name and number, progress saved on the phone, status timeline, scam check, "My data and permission", self sign-up with a one-time SMS code and a 4-digit PIN |
| Helper | Helper Mode: one phone, many families, a PIN and separate consent per family |
| Officer | Review queue (priority, confidence, waiting time), AI notes on every case, approve / reject / ask for info / assign / escalate / close, held payouts with a four-eyes rule |
| Admin | Rule editor + Digital Twin, cost model, AI profile and Kill AI, evaluation dashboard, programs (tenants) with usage limits, API keys, webhooks, API docs, Judge Mode, mock phone |
| Auditor | Read-only hash-chained audit log, readable decision trace |
| Platform | RS256 JWT + role checks in every service, consent enforced server-side, payment state machine, double-entry ledger, reconciliation, offline outbox, rate limiting |
| Landing now | "Ask about the program" with sources <!-- STATUS: pending merge --> · fraud-ring signals <!-- STATUS: pending merge --> · read-only tool-calling assistant <!-- STATUS: pending merge --> · Scam Map <!-- STATUS: pending merge --> |

## AI features

| # | Feature | Model or tool | Safety rule around it |
| - | ------- | ------------- | --------------------- |
| 1 | Urdu speech to text | Groq Whisper `whisper-large-v3` (Gemini wired as an alternative, capped at USD 2, currently without credit) | Not understood twice → she types or a helper does. Never a loop, never a guess. |
| 2 | Claim extraction from speech | Groq `openai/gpt-oss-120b`, Zod-validated, one repair attempt | CNIC and phone removed before the prompt. The next question is picked by code. She confirms a read-back before sending. |
| 3 | Urdu text to speech | 194 recorded prompts; `POST /ai/speak` (Microsoft `ur-PK-UzmaNeural` via `msedge-tts`, disk cache, circuit breaker); phone voice last | Speech only reads text the system already decided to show. |
| 4 | CNIC photo checks | Tesseract OCR, `jsqr`, error-level analysis, EXIF, blur, all on our server | The image never goes to an outside model. A failed check never rejects: retake if blurry, otherwise an officer. |
| 5 | Scam classification | Seal (HMAC) → red-flag rules → LLM | The LLM is asked only when the first two cannot settle it. Disagreement → "not sure". |
| 6 | Decision routing | Rule engine (JSON Logic) + calibrated confidence. No LLM. | Three lanes: auto-approve, ask more, human review. Automation never rejects. |
| 7 | Structured outputs | Zod schemas, versioned task names | A malformed answer counts as "not sure". |
| 8 | Guardrails + human approval | PII redaction, caution-only AI notes, capped client confidence, Kill AI | What the phone reports can move a claim toward an officer, never toward approval. First claim of a new account always goes to an officer. |
| 9 | Explanations | Template from the rule clauses (Urdu + English); `POST /ai/explain` rewrites it for the ear | The rewrite is dropped if it adds a number or contradicts the lane. The web app speaks the engine's own text today. |
| 10 | Evaluation dashboard | Engine run on a synthetic labelled set; live program numbers; AI call stats | False alarms shown next to wrong approvals. Golden-set gates in CI. |
| 11 | Memory | Claim draft kept on the phone for 24 hours; offline outbox | On-device only. |
| 12 | RAG with sources <!-- STATUS: pending merge --> | `services/knowledge`, Gemini embeddings, exact excerpts with citations | Refuses questions outside the policy documents. |
| 13 | Fraud-ring anomaly signals <!-- STATUS: pending merge --> | SQL aggregates + a pure detector | Only adds a flag for an officer. The claimant is told nothing about the check. |
| 14 | Read-only assistant <!-- STATUS: pending merge --> | Tool calling, `POST /ai/assist` | Read-only tools: it cannot approve, pay or edit. |

Why each model and tool was chosen: [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md#2-ai-models-and-tools-and-why-each-was-chosen).

## Architecture

Microservices behind a gateway, one Postgres schema per service, durable events through a transactional outbox + pg-boss. Every service verifies the user's token itself.

| Service      | Port | Owns |
| ------------ | ---- | ---- |
| `gateway`    | 4000 | Public entry: routing, Helmet, CORS allowlist, rate limit, `/status`, API docs for every service (`/docs/:service`), usage metering |
| `identity`   | 4001 | Programs (tenants), users, RS256 tokens + refresh rotation, sign-up, consent, Helper Mode, API keys |
| `cases`      | 4002 | Claims, JSON Logic rules + versions, decision engine, officer queue, Digital Twin, evaluation |
| `ai`         | 4003 | `AI_PROFILE` switch (dev / demo / offline), LLM + Urdu speech with fallback, vision, scam check, Kill AI |
| `payments`   | 4004 | Payout state machine, idempotency, title fetch, maker-checker, double-entry ledger, reconciliation, webhooks, Haq Receipt |
| `audit`      | 4005 | Append-only hash-chained log of every event |
| `rails-mock` | 4006 | Simulated NADRA, Raast, household data, SMS, with fault injection |
| `judge`      | 4007 | Judge Mode scenarios |
| `knowledge`  | 4008 | Synthetic policy corpus, citation-grounded program answers <!-- STATUS: pending merge --> |

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
pnpm db:push && pnpm db:seed
pnpm start         # all services (or `pnpm dev` for watch mode)
pnpm dev:web       # web app on http://localhost:3000
```

Check `http://localhost:4000/status`. API docs for every service: `http://localhost:4000/docs/<service>`.

Add your own `GROQ_API_KEY` (and optionally a Gemini key) to `.env` for live AI. Without keys the system still runs: AI answers become "not sure" and cases go to people. Never commit `.env`.

**AI profile:** `AI_PROFILE=dev` (free Groq first), `demo` (paid Gemini first), `offline` (no outside AI). Admins can switch at runtime in Admin > AI.

## Testing

| Command | What it proves |
| ------- | -------------- |
| `pnpm test` | Unit and property tests for every package and service (decision engine, state machine, seal, hash chain, name matching, PII redaction, AI fallback…) |
| `pnpm fuzz --unit` | Property tests only: 46 properties × 2,500 generated cases (115,560 in total), without touching running services |
| `pnpm fuzz` | About 1,000 generated, mostly hostile requests through a local gateway: no 5xx, role checks on every route, forged tokens refused, one case per idempotency key |
| `pnpm e2e` | End-to-end worst cases through the gateway: forged and expired tokens, refresh-token theft, brute force, injection, double-submit races, consent, Helper Mode PINs, Raast timeout after debit, mule account, maker-checker, seal, partner API, audit chain |
| `pnpm chaos` | Kills services mid-flow: rails down → human review; audit down → no event lost; payments down → paid once after restart; AI down → clean 503 |
| `pnpm load` | Concurrent load through the gateway: p50 / p95 / p99 and error rate per endpoint |
| `pnpm --filter @haqdaar/cases eval:check` | Golden-set gates for the decision engine (also in CI): wrong auto-approvals ≤ 0.5%, calibration matches a refit |
| `pnpm eval:ai` | Claim extraction and scam check on 50 synthetic transcripts and 40 messages; see [docs/EVAL_AI.md](docs/EVAL_AI.md) |
| `pnpm audio` | Re-records the fixed Urdu prompts after a wording change |
| `pnpm demo:reset` | Clears claims, payouts and consents for a fresh rehearsal (the audit log is never touched) |

## Real vs simulated

**Real:** Urdu speech to text, LLM calls, Urdu voice, OCR, QR decoding, forgery heuristics, RS256 login and server-side permissions, PostgreSQL, the hash-chained audit log, the HMAC seal, the rule engine and its calibration, the payment state machine and ledger logic, offline sync.

**Simulated:** NADRA, Raast, the household registry, SMS, bank accounts, the "Sahara" program and its policy documents, and every person, CNIC and phone number.

**Limits we know about:** everything is measured on synthetic data; forgery checks are heuristics that route to a person; scam recall is measured on templated scams only. The full list is in [docs/REAL_VS_SIMULATED.md](docs/REAL_VS_SIMULATED.md).

## What we did not build, and why

| Not built | Why |
| --------- | --- |
| Subscription billing | A relief program has no paying subscribers. Plans are modelled as a monthly request quota per program, which is reported but not enforced. |
| WhatsApp and email notifications | SMS itself is simulated, so there was no real channel to send through. In-app status and the mock SMS cover the flow. |
| Versioned database migrations | Tables are created with `prisma db push`. One person owned every schema for 48 hours. |
| User management screen | An admin can launch a program with its first admin; other accounts come from the seed or self sign-up. |
| More partner API routes | One works (scam check with an API key). The `cases:status` scope exists but has no route yet. |
| Complaint case from the Haq Receipt; fraud-desk queue for "not sure" scam messages | The verdict and the receipt tell the citizen what to do; no case is opened yet. |
| Claim progress across devices | Saved on the phone only. |
| A second approver for rule publishing | Payouts have maker-checker; rule changes do not yet. |

We chose one task done deeply over many done thinly, as the brief asks.

## Submission

- Live demo: <https://172-198-74-124.sslip.io>
- Demo video: _add the public Google Drive link_
- Slides (optional): _add the link_

## Team

| Person | Owns |
| ------ | ---- |
| Umer | Backend services, integration, security, payments, deploy |
| Ali Malick | Voice and language (speech in and out, spoken explanations) |
| Ayan | Knowledge (RAG), AI evaluation, fraud signals |

Build plan and original design notes: [docs/PLAN.md](docs/PLAN.md).
