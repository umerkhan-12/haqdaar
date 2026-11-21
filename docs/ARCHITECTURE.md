# Haqdaar — System Architecture

> Microservices with clear ownership, built to run on free tiers. Every decision below has a "why" so the team can defend it to the judges.

## 1. Overview

```
                    +---------------------------+
   Browser / PWA -->|  web  (Next.js, :3000)    |
                    +-------------+-------------+
                                  | HTTPS (JWT)
                    +-------------v-------------+
                    |  gateway (:4000)          |  helmet, CORS, rate limit,
                    |  routing + request id     |  request id, aggregated docs
                    +--+----+----+----+----+--+-+
                       |    |    |    |    |  |
        +--------------+    |    |    |    |  +----------------+
        v                   v    |    v    v                   v
  +-----------+   +---------+  +-v--------+ +---------+  +------------+
  | identity  |   | cases   |  | ai       | |payments |  | rails-mock |
  | :4001     |   | :4002   |  | :4003    | | :4004   |  | :4006      |
  | auth,     |   | claims, |  | LLM, STT,| | payouts,|  | NADRA,     |
  | tenants,  |   | rules,  |  | vision,  | | ledger, |  | Raast,     |
  | consent,  |   | decision|  | AI_PROFILE |recon,   |  | household, |
  | api keys  |   | queue   |  | switch   | | webhooks|  | SMS        |
  +-----+-----+   +----+----+  +----------+ +----+----+  +------------+
        |              |                         |
        |  outbox ---> |  pg-boss event bus  <---+-----> audit (:4005)
        |              |  (durable, in Postgres)          hash-chained log
        v              v                         v
  +------------------------------------------------------------------+
  | PostgreSQL — one schema per service: identity, cases, payments,  |
| audit, rails, knowledge (+ pgboss schema for the bus)             |
  +------------------------------------------------------------------+
```

## 2. Services and what they own

| Service      | Port | Owns (data)                                                                  | Main responsibilities                                                                                                                                        | Owner    |
| ------------ | ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `gateway`    | 4000 | nothing                                                                      | Single public entry: routing, Helmet, CORS allowlist, rate limiting, request id, docs index                                                                  | A (Umer) |
| `identity`   | 4001 | tenants, users, refresh tokens, API keys, consents, helper links             | Login, RS256 token issuing, refresh rotation + reuse detection, roles, Helper PIN switch, consent grant/withdraw, JWKS-style public key                      | A (Umer) |
| `cases`      | 4002 | cases, case events, documents meta, rules + versions, decisions              | Claim lifecycle, decision engine (JSON Logic + cost threshold), officer queue, Digital Twin replay                                                           | A (Umer) |
| `ai`         | 4003 | prompt versions, AI call log, cache                                          | **AI_PROFILE switch** (dev/demo/offline), LLM + STT routing with fallback and circuit breaker, structured outputs, scam check, vision, explanations, Kill AI | B        |
| `payments`   | 4004 | payments, attempts, ledger entries, approvals, reconciliation runs, webhooks | Payout state machine, idempotency, title fetch, maker-checker, double-entry ledger, reconciliation, signed webhooks                                          | A (Umer) |
| `audit`      | 4005 | audit log (append-only)                                                      | Consumes every event, hash-chains it, verify-chain endpoint, read-only for auditors                                                                          | A (Umer) |
| `rails-mock` | 4006 | mock citizens, mock bank accounts, mock statements                           | Simulated NADRA, Raast (title fetch, transfer, status, statement), household data, SMS — with failure injection (timeout, fail, duplicate)                   | C        |
| `knowledge`  | 4008 | policy documents, chunks and embeddings                                      | Policy-only retrieval; sends bounded sources to AI for extractive answers                                                                                    | B (Ayan) |
| `web`        | 3000 | IndexedDB outbox (on the phone)                                              | Citizen voice flow, helper, officer, admin, auditor, Judge Mode                                                                                              | C        |

**Rule:** a service never reads another service's schema. It calls its API or listens to its events.

## 3. Communication

### 3.1 Synchronous (HTTP/REST)

- **Browser → gateway → service.** The gateway forwards the user's JWT unchanged; **every service verifies it itself** (zero trust — the gateway is not a security boundary on its own).
- **Service → service.** Through `ServiceClient` (in `@haqdaar/nest-kit`):
  - short-lived **internal token** (HS256, `aud` = target service, 60 s expiry)
  - timeouts (3 s default, 30 s for AI)
  - retries **only** for idempotent requests (GET, or POST with an idempotency key)
  - a **circuit breaker** per upstream, so one slow service cannot take down the others

### 3.2 Asynchronous (events)

- **Transactional outbox:** a service writes its business row **and** an `outbox` row in the same database transaction. A relay publishes outbox rows to **pg-boss** and marks them sent. No event is lost if the process crashes between "save" and "publish".
- **pg-boss** (queues inside Postgres): durable, retries with backoff, dead-letter queue. No Redis or Kafka to host or secure.
- **Consumers are idempotent:** every event has an `eventId`; consumers record processed ids.

| Event                            | Producer | Consumers                                              |
| -------------------------------- | -------- | ------------------------------------------------------ |
| `identity.tenant.created`        | identity | cases (publish rule v1 + default costs), audit         |
| `identity.consent.withdrawn`     | identity | cases (block access), audit                            |
| `cases.case.submitted`           | cases    | ai (pre-process docs), audit                           |
| `cases.case.decided`             | cases    | payments (create payout if approved), audit, webhooks  |
| `payments.payment.state_changed` | payments | cases (timeline), audit, webhooks                      |
| `ai.call.completed`              | ai       | audit (AI usage trail), identity (per-tenant AI usage) |
| `*`                              | all      | audit (everything is logged)                           |

## 4. Security model

| Layer              | Mechanism                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| User tokens        | **RS256 JWT**: identity holds the private key, every other service has only the public key. A compromised service cannot mint tokens            |
| Refresh tokens     | Opaque, stored hashed, rotated on every use; reuse of an old token revokes the whole family                                                     |
| Passwords / PINs   | argon2id                                                                                                                                        |
| Service-to-service | Internal HS256 token with audience + 60 s expiry; internal routes reject user tokens                                                            |
| Authorization      | Global guards in every service, **deny by default**: JWT → Roles → Tenant → (Consent where personal data is read). `@Public()` must be explicit |
| Tenant isolation   | `tenantId` from the token, never from the request body                                                                                          |
| PII                | CNIC/phone AES-256-GCM encrypted at rest + HMAC hash for lookups (identity, cases)                                                              |
| Edge               | Helmet, CORS allowlist, rate limiting at the gateway; per-route throttles in services                                                           |
| AI                 | PII stripped before prompts, documents treated as data not instructions, payment tool needs a human approval token                              |

## 5. AI profile switch

`AI_PROFILE` selects provider order without code changes:

| Profile   | LLM order                    | Speech-to-text order         | Used when                  |
| --------- | ---------------------------- | ---------------------------- | -------------------------- |
| `dev`     | Groq → Gemini (free key)     | Groq Whisper → Gemini        | The 48-hour build          |
| `demo`    | **Gemini (paid key)** → Groq | Groq Whisper → Gemini (paid) | Live judging only          |
| `offline` | deterministic mock           | mock                         | Tests, CI, and **Kill AI** |

Every provider sits behind the same interface, with a timeout, a circuit breaker and automatic fallback to the next provider. **Kill AI** switches the router to `offline` at runtime: the system keeps working, routes uncertain cases to humans, and never auto-approves on mock output.

## 6. Deployment

| Environment  | How                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Local        | `docker compose up -d` (Postgres) + `pnpm dev` (all services in watch mode)                                         |
| Cloud (free) | Web on Vercel. Services on Render free web services (one per service), Postgres on Supabase with schema-per-service |
| Fallback     | Laptop runs the full stack for the live demo                                                                        |

## 7. Why microservices here (judge answer)

- **Blast radius:** the AI service can be slow or down (rate limits) while login, payments and audit keep working.
- **Security boundaries:** only `identity` can mint tokens; only `payments` can move money; `audit` is append-only and separate from the services it audits.
- **Team parallelism:** each person owns services with their own schema and contract, so 3 people do not block each other.
- **Honest trade-off:** more moving parts and network calls. We keep it manageable with one shared toolkit (`nest-kit`), shared Zod contracts, one database instance with separate schemas, and a bus that needs no extra infrastructure.
