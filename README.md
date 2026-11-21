# Haqdaar

> **PROTOTYPE ONLY — not an official government service.** All identity, payment, SMS and data services are simulated. No real personal data is used.

**Coder's Cup '26 · Hagrid's Hackathon · The Last Mile: AI on Public Rails**

We help **a low-literacy widow** **claim her monthly relief payment** even though **she cannot read forms, has a weak phone signal, and keeps receiving fake "relief payment" messages that could steal her savings.**

_Knows when it doesn't know. Proves who's real._

## Start here

- 📄 **Full build plan:** [docs/PLAN.md](docs/PLAN.md) (also as [PDF](docs/Haqdaar-Plan.pdf))
- 👥 Team split, timeline and demo script are in the plan (sections 13–15)

## What makes it different

1. **Haqdaar Seal:** genuine program messages carry a signed code, so "real" is proven, not guessed.
2. **Haq Receipt:** the beneficiary hears the exact payout amount, so middlemen can't skim it.
3. **Judge Mode:** one button per hackathon challenge, so judges can try to break it live.
4. **The LLM never approves; automation never rejects.** Auto-approve only when `p ≥ 0.988` (cost-based threshold).

## Architecture

Microservices behind a gateway, one Postgres schema per service, durable events through a transactional outbox + pg-boss. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · service contracts: [docs/CONTRACTS.md](docs/CONTRACTS.md).

| Service      | Port | Owns                                                                                            |
| ------------ | ---- | ----------------------------------------------------------------------------------------------- |
| `gateway`    | 4000 | Public entry: routing, Helmet, CORS allowlist, rate limit, `/status`                            |
| `identity`   | 4001 | Tenants, users, RS256 tokens + refresh rotation, consent, Helper Mode                           |
| `cases`      | 4002 | Claims, JSON Logic rules + versions, decision engine, officer queue, Digital Twin               |
| `ai`         | 4003 | `AI_PROFILE` switch (dev / demo / offline), LLM + Urdu STT with fallback, scam check, Kill AI   |
| `payments`   | 4004 | Payout state machine, idempotency, maker-checker, double-entry ledger, reconciliation, webhooks |
| `audit`      | 4005 | Append-only hash-chained log of every event                                                     |
| `rails-mock` | 4006 | Simulated NADRA, Raast, household data, SMS, with failure injection                             |

```
apps/web            Next.js PWA (citizen, helper, officer, admin, auditor, Judge Mode)
services/*          NestJS (Fastify) microservices
packages/shared     Zod contracts, events, domain rules shared by web and services
packages/nest-kit   Shared service toolkit: bootstrap, auth guards, errors, service client, circuit breaker, event bus, crypto, seal
infra/              Local Postgres (docker compose)
scripts/            key generation, env wrapper, run-all launcher
docs/               plan, architecture, contracts
```

## Stack

TypeScript · NestJS 11 (Fastify) · Next.js · Zod · Prisma · PostgreSQL · pg-boss · Groq (Llama + Whisper) · Gemini · Vercel · Render. Build cost: free tiers only (paid Gemini only on judging day, via `AI_PROFILE=demo`).

## Setup

Requirements: Node 22+, pnpm 9, Docker.

```bash
pnpm install
pnpm keys          # creates .env with fresh RS256 keys and secrets
pnpm db:up         # local Postgres on :5433
pnpm db:generate && pnpm build
pnpm db:push && pnpm db:seed
pnpm start         # all services (or `pnpm dev` for watch mode)
```

Then open `http://localhost:4000/status`. Each service has Swagger at `http://localhost:<port>/docs`.

**Demo accounts** (synthetic, password `demo1234`): citizen `03001110001`, helper `03001110002`, officer `03001110003` and `03001110006`, admin `03001110004`, auditor `03001110005`.

## Testing

| Command           | What it proves                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`       | Unit tests for every package and service (decision engine, state machine, seal, hash chain, name matching, PII redaction, AI fallback…)                                                                                                                                                                                            |
| `pnpm e2e`        | 47 end-to-end worst cases through the gateway: forged / `alg:none` / algorithm-confusion / expired tokens, refresh-token theft, brute force, injection, double-submit races, consent, Helper Mode PINs, Raast timeout after debit (paid once), mule account hold, maker-checker, Haq Receipt seal, partner API scopes, audit chain |
| `pnpm chaos`      | Kills services mid-flow: rails down → human review; audit down → no event lost; payments down → paid once after restart; AI down → clean 503                                                                                                                                                                                       |
| `pnpm load`       | Concurrent load through the gateway: p50 / p95 / p99 and error rate per endpoint                                                                                                                                                                                                                                                   |
| `pnpm demo:reset` | Clears claims, payouts and consents for a fresh rehearsal (audit log is never touched)                                                                                                                                                                                                                                             |

**AI profile:** set `AI_PROFILE=dev` (Groq first, free) during the build, `demo` (paid Gemini first) on judging day, `offline` for tests. Admins can also switch at runtime: `POST /ai/profile`.

## Real vs simulated

See [docs/PLAN.md §16](docs/PLAN.md#16-real-vs-simulated-for-readme-and-judges).
