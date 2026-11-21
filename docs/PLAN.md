# Haqdaar — Build Plan

**Coder's Cup '26 · Hagrid's Hackathon · "The Last Mile: AI on Public Rails"**
Build window: Fri 20 Nov 2026, 6:00 PM → Sun 22 Nov 2026, 6:00 PM PKT · Final evaluation: Mon 23 Nov, FAST-NUCES Karachi Library

> **PROTOTYPE ONLY.** Haqdaar is a hackathon prototype, not an official government service. Every identity, payment, SMS and data service is simulated. No real personal data is used anywhere.

---

## 1. The one sentence

> We help **a low-literacy widow** **claim her monthly relief payment** even though **she cannot read forms, has a weak phone signal, and keeps receiving fake "relief payment" messages that could steal her savings.**

**Tagline:** _Knows when it doesn't know. Proves who's real._

One task (claiming a mock cash-transfer relief payment, the "Sahara Program"), done end to end. Every persona from the brief touches this one task.

## 2. Why we win (our strategy)

The judges said they score **judgment, not speed** — how the system behaves with risk, mistakes and surprises. Experienced teams will build many features thinly. We build one task deeply and **let the judges attack it live**.

Three ideas other teams will not have:

1. **Haqdaar Seal — prove real instead of guessing fake.** Every genuine program message carries a signed verification code / QR. Valid seal = certainly real. No seal but claims to be "relief" = certainly not from us. AI is only used for the leftovers, and says "not sure" when unsure.
2. **Haq Receipt — protect her from the middleman.** At payout the beneficiary hears the exact amount in Urdu on her own phone. If she got less, a complaint case opens automatically against that helper/agent.
3. **Judge Mode — "Try to break it".** A panel with one button per challenge (01–08) plus "Kill AI" and "Go offline". The judges' checklist becomes our demo.

Core principles we will defend in Q&A:

- **The LLM never approves anything.** A versioned rule engine + calibrated scores decide. The LLM extracts, classifies and explains.
- **The system never auto-rejects.** Only humans reject. Automation can only approve (when very sure) or escalate.
- **Every decision is reproducible:** input hash + rule version + model version + confidence + result.
- **Failure is safe:** if AI is down or unsure, the case goes to a human with notes. Nothing guesses silently.

## 3. Personas and roles (we use all 5)

| Role                   | Who                                     | What they do in Haqdaar                                                                                                      |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Citizen**            | Widow (Zainab, mock)                    | Voice-first Urdu claim, CNIC photo, track status by icons + audio, manage consent, check suspicious SMS, confirm Haq Receipt |
| **Community helper**   | Helper serving 40 families on one phone | Helper Mode: switch family with that family's PIN, act _on behalf of_ with per-family consent, time-limited access           |
| **Department officer** | Relief officer / Fraud-desk officer     | Review queue sorted by risk + confidence, AI case notes, approve / reject / ask for more proof                               |
| **Admin**              | Program admin                           | Users and roles, rule editor (no code), Digital Twin, cost settings, mock services, Judge Mode                               |
| **Auditor**            | Independent auditor                     | Read-only: audit log (tamper-evident), consent history, every AI decision trace                                              |

The shopkeeper uses the **Citizen** role with the scam checker (and can report scam messages to the Scam Map).

## 4. End-to-end flow (the main demo)

```
Citizen speaks Urdu ──► Whisper STT ──► LLM extracts fields (Zod-validated)
        │                                      │ missing/invalid → asks again by voice
        ▼                                      ▼
CNIC photo (compressed on phone) ──► OCR + QR + forgery checks (background job)
        │
        ▼
Claim Agent (allowlisted tools only)
   1. verify_identity      → mock NADRA (fuzzy name match, CNIC exact)
   2. fetch_household      → mock data-exchange service (needs consent)
   3. check_duplicates     → existing claims / persons
   4. evaluate_rules       → active rule version (JSON Logic)
   5. score_risk           → calibrated confidence + anomaly flags
        │
        ▼
Decision lanes
   AUTO_APPROVE  (p ≥ threshold, no flags, under amount cap, auto-budget not exhausted)
   ASK_MORE      (missing / unreadable data → tells her exactly what is needed, by voice)
   HUMAN_REVIEW  (low confidence, any flag, near-duplicate, forgery suspicion, rule fail)
        │
        ▼
Approved ──► initiate_payment (requires approval token) ──► mock Raast ──► Haq Receipt (voice)
        │
        ▼
Citizen: simple spoken reason      Auditor: full trace
```

## 5. Feature list (mapped to the brief)

Priority: **P0** = must work for the demo · **P1** = should have · **P2** = only if time remains.

### 5.1 Core platform (all required)

| Feature                               | How                                                                                                                            | Priority |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Secure login + RBAC                   | JWT access (15 min) + refresh tokens, argon2 hashing, role + tenant checked **on the server** for every route                  | P0       |
| Dashboard                             | Per role: citizen (icons + audio progress), officer (queue), admin (stats), auditor (logs)                                     | P0       |
| Case management                       | Create, assign, escalate, close; full event timeline per case                                                                  | P0       |
| Public REST API + API keys + Swagger  | NestJS + `nestjs-zod` + `@nestjs/swagger` → OpenAPI at `/docs`; API keys hashed, scoped, rate-limited (`ApiKeyGuard`)          | P0       |
| Audit log                             | Every user / AI / agent / system action, append-only, **hash-chained** (each row stores hash of previous row → tamper-evident) | P0       |
| Consent management                    | See, share, withdraw, correct; enforced by `ConsentGuard` on every personal-data read                                          | P0       |
| Mock identity, payment, data services | `/mock/nadra`, `/mock/raast`, `/mock/household`, `/mock/sms` with their own API keys and simulated latency/failures            | P0       |

### 5.2 Optional platform features (we pick 8 because our stack makes them cheap)

| Feature                                                        | How                                                                                                                                                                               | Priority |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Admin rule editor                                              | JSON Logic rules with a form-based editor; versioned; instant effect                                                                                                              | P0       |
| Officer review queue with priority + confidence sorting        | Sorted by risk × amount × waiting time                                                                                                                                            | P0       |
| Low-bandwidth / offline mode                                   | PWA, IndexedDB outbox, idempotency keys, tiny pages, cached audio                                                                                                                 | P0       |
| Background jobs and queues                                     | pg-boss for OCR, forgery, LLM calls, notifications                                                                                                                                | P0       |
| Rate limiting + error handling                                 | `@nestjs/throttler`, global exception filter (uniform error format), retries with backoff for mocks                                                                               | P0       |
| Multi-tenant workspaces                                        | Tenants: _Relief Department_ and _Fraud & Complaints Desk_; `tenant_id` on every row                                                                                              | P1       |
| Notifications                                                  | In-app + mock SMS phone screen + email (Resend)                                                                                                                                   | P1       |
| Analytics dashboard per tenant                                 | Claims/day, lanes, approval time, scam types                                                                                                                                      | P1       |
| Signed webhooks (added for the SaaS rubric)                    | Partners subscribe to `case.decided`, `payment.succeeded`, `consent.withdrawn`; body signed with HMAC-SHA256 + timestamp, retries with backoff, delivery log with "resend" button | P1       |
| Tenant onboarding + usage metering (added for the SaaS rubric) | Admin "Launch a program" wizard creates a tenant, its rules, API key and cost settings; per-tenant usage page: API calls, AI calls, AI cost, quota bar                            | P1       |

Skipped on purpose: paid subscription plans (a quota per tenant is enough to show the idea). _Reason for judges: billing does not help the widow finish her task._

### 5.3 AI features (we use 10 of 11, all integrated into the one task)

| AI feature                          | Where it lives                                                                                                                                                               | Priority |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Voice (Urdu STT + TTS)              | Groq Whisper large-v3 for STT; pre-generated Urdu audio clips + Edge TTS for TTS                                                                                             | P0       |
| Structured outputs                  | LLM fills a Zod schema; invalid output is rejected and retried, never trusted                                                                                                | P0       |
| Classification + routing (Jev idea) | Scam / complaint / request classifier → confidence → auto / ask more / human                                                                                                 | P0       |
| Computer vision                     | OCR of mock CNIC (tesseract.js), QR decode (jsQR), forgery: error-level analysis (sharp), EXIF editor tags, OCR vs QR vs NADRA mismatch, blur detection (Laplacian variance) | P0       |
| Agent + tool calling                | Claim Agent with allowlisted tools; risky tools need human approval token                                                                                                    | P0       |
| Guardrails + human approval         | Output validation, PII redaction in prompts, blocked topics, payment requires approval, "not sure" handoff                                                                   | P0       |
| Explainability                      | User: 1–2 sentence Urdu voice reason built from rule-clause texts. Auditor: full trace                                                                                       | P0       |
| Anomaly detection                   | Repeat claims, one phone on many CNICs, helper complaint rate, payment spikes (z-scores + rules)                                                                             | P1       |
| Evaluation dashboard                | Accuracy, false approvals, false alarms, auto-rate, expected cost, latency, LLM cost (Langfuse)                                                                              | P0       |
| Memory and context                  | Case progress saved server-side + IndexedDB; resume across sessions and devices                                                                                              | P0       |
| RAG                                 | "Ask about the program" over mock policy docs, answers with sources, refuses outside sources (pgvector)                                                                      | P1       |

## 6. The 8 technical challenges — our answers

Each challenge has a **Judge Mode button** that reproduces it live.

### Challenge 01 — The cost of being wrong

Cost model (admin-editable, so the numbers can change without code):

| Outcome                         | Cost (PKR-equivalent)          | Reasoning                                                                 |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Wrong approval (fraud paid out) | **25,000**                     | 10,000 payout lost + recovery effort + trust harm to the real beneficiary |
| Human review                    | **300**                        | ~10 min officer time + citizen waits ~1 day                               |
| Ask for more proof              | **150**                        | Citizen effort, re-submission                                             |
| Wrong rejection                 | **not possible by automation** | Only humans reject                                                        |

**Auto-approve rule:** approve alone only when the expected cost of approving is lower than the cost of a review:

```
(1 − p) × 25,000  <  300   ⇒   p  >  1 − 300/25,000  =  0.988
```

Extra safety rails (all configurable):

- Hard flags always go to a human, whatever p is: forgery suspicion, near-duplicate, identity ambiguity, anomaly, first-time helper.
- Amount cap for auto-approval (e.g. ≤ PKR 10,500).
- **Auto-approval circuit breaker:** if auto-approvals in the last hour exceed 3× the normal rate, the auto lane pauses and everything goes to humans.

**Showing the numbers:** a synthetic labelled set of 500 cases (legit + 5 fraud types). The evaluation dashboard plots expected total cost vs threshold and marks the chosen threshold; shows confusion matrix, false-approval rate, % automated, average time saved.

### Challenge 02 — Saying "I am not sure"

- Confidence is **calibrated** (Platt scaling fitted on the synthetic set), not a raw LLM number.
- Below threshold, or any hard flag → `HUMAN_REVIEW` with an **AI case note**: what was checked, what passed, what failed, what is uncertain and why, suggested next step.
- Citizen hears: _"Aap ka case ek afsar dekhenge. Aap ko 2 din mein jawab milega."_ (An officer will look at your case. You'll get an answer in 2 days.)
- If the LLM/OCR service is down → case goes to a human with note "AI unavailable". **Silent guessing is impossible by design.**

### Challenge 03 — Bad data

Name matching pipeline:

1. Normalize: lowercase, strip honorifics (Mr, Mst, Bibi, Syed…), collapse spaces and doubled letters.
2. Transliteration map: `muhammad | mohammad | muhammed | mohammed | mohd | md → mhd`, `khan | khaan → khan`, `fatima | fatimah | fatma → ftm`, etc.
3. Similarity: Jaro-Winkler on normalized names + father's name.
4. **Match rules:**

| CNIC      | Name similarity | DOB / father         | Result                                                    |
| --------- | --------------- | -------------------- | --------------------------------------------------------- |
| exact     | ≥ 0.90          | at least one matches | **Same person**                                           |
| exact     | < 0.90          | —                    | **Human review** (possible data error or identity misuse) |
| different | ≥ 0.92          | both match           | **Possible duplicate person** → human                     |
| missing   | any             | —                    | **Ask for more** (never match on name alone)              |

- Never auto-merge records. Never crash on missing fields (Zod `.partial()` + explicit "missing" state).
- Duplicates in seed data are deliberate (same person, 3 spellings, 2 claims).

### Challenge 04 — Rules that change

- Rules stored as **JSON Logic** in `rule_versions` (draft → active). Evaluated at runtime by `json-logic-js`.
- Each rule clause has an id + Urdu/English explanation text, so explanations come straight from the rule trace.
- Admin publishes v2 → the next case uses v2 immediately. No code change, no redeploy.
- Every decision stores `rule_version_id`; old decisions still show v1.
- **Digital Twin** (bonus): before publishing, replay the draft on past cases → "37 decisions would change: 30 human→approve, 7 approve→human; expected cost −PKR 4,200".

Example rule (v1):

```json
{
  "and": [
    { "<": [{ "var": "household.monthly_income" }, 40000] },
    { ">=": [{ "var": "household.size" }, 3] },
    { "==": [{ "var": "already_enrolled" }, false] }
  ]
}
```

### Challenge 05 — Explain and audit

| View        | Content                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Citizen** | 1–2 simple sentences, Urdu voice + icons: _"Aap ki aamdani 40,000 se kam hai aur ghar mein 5 log hain, is liye aap ko madad mil gayi."_ (Your income is under 40,000 and there are 5 people in your home, so you have been approved.) |
| **Auditor** | Input hash, extracted fields, OCR/forgery scores, identity match details, rule version + per-clause result, model + prompt version, calibrated confidence, lane, threshold used, cost settings version, actor, timestamps             |

Audit log is append-only and hash-chained; the auditor screen has a **"Verify chain"** button.

### Challenge 06 — Consent and take-back

- Consent = (citizen, grantee [department / helper], data fields, purpose, expiry, status).
- Every personal-data route is marked `@RequireConsent('income')` and checked by `ConsentGuard`. Withdrawn → **HTTP 403 `CONSENT_WITHDRAWN`**, logged.
- Citizen screen "**Who has my data**": list of grantees + access log ("Relief officer viewed your income, 21 Nov 7:40 PM").
- Correct data → creates a correction case; the old value is kept in history.
- Demo: citizen withdraws → officer refreshes → blocked → auditor sees both events.

### Challenge 07 — Works for everyone

- **Icon-first UI:** every screen has a big speaker button that auto-plays the Urdu prompt; answers by voice or big ✓ / ✗ buttons; progress shown as a picture path.
- **Small pages:** < 100 KB per screen; photos compressed on the phone to ~150 KB; audio prompts ~10 KB each, cached by the service worker.
- **Offline-first:** every step saved to IndexedDB; outbox syncs when signal returns; each request carries an idempotency key, so retries never create duplicates.
- **Numbers spoken offline:** amounts built from pre-recorded number clips ("das hazaar" + "paanch sau").

### Challenge 08 — Scams and fake documents

Scam checker pipeline:

1. **Seal check:** does the message contain a valid Haqdaar Seal code (HMAC, e.g. `HQ-7F3K-92`) or signed QR? → **REAL** (certain).
2. **Claims to be from the program but no valid seal** → **NOT FROM US** (certain about origin) + red flags explained.
3. **Otherwise:** rule red-flags (asks for PIN/OTP, "fee to release payment", link, urgency, unknown number) + LLM classifier (Zod output: label, confidence, red_flags) → calibrated → **SCAM / SAFE / NOT SURE** → not-sure goes to the Fraud Desk queue.

Fake documents: ELA heatmap, EXIF editing-software tags, OCR vs QR vs mock NADRA mismatch, blur score (blurry → ask for a new photo, not "forged").

**Honesty:** evaluation dashboard shows false alarms on a labelled set of ~200 messages (Urdu, Roman Urdu, English) and on genuine documents. _Blocking a real person is a cost, so a suspicious document goes to a human — it is never auto-rejected._

## 7. Bonus features

| Bonus                                        | Status                                              |
| -------------------------------------------- | --------------------------------------------------- |
| **Digital Twin** (rule replay on past cases) | P0 — nearly free once rules are versioned           |
| **Helper Mode** (one phone, 40 families)     | P0 — part of our story                              |
| Offline-First Sync                           | Already covered by Challenge 07 (P0)                |
| Scam Map (by type, area, time)               | P2 — only if time remains (Leaflet + OpenStreetMap) |

### Helper Mode details

- Helper sees family cards (name + audio, no photos). Switching to a family requires that family's 4-digit PIN.
- Every action is recorded as _"Helper Asma on behalf of Zainab"_.
- Per-family consent; helper access expires (e.g. 30 days) and can be revoked by the citizen.
- Auto-lock after 2 minutes idle; nothing of family A is visible while working on family B (server enforces it).

### Haq Receipt details

- On payout: beneficiary hears _"Aap ko 10,500 rupay milne chahiye. Kya aap ko poore paise mile?"_ (You should receive 10,500 rupees. Did you get the full amount?) ✓ / ✗
- ✗ → complaint case to the Fraud Desk with the helper/agent attached; helper complaint rate feeds anomaly detection.

### Judge Mode panel

| Button                    | What judges see                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------- |
| 01 Risky claim            | High amount + mild flags → goes to human, cost math shown                              |
| 02 Unsure case            | Low confidence → handoff with case note                                                |
| 03 Messy name             | "Mohammad" vs "Muhammad" matched; near-duplicate → human                               |
| 04 Change rule            | Admin edits income limit → next case uses v2; old shows v1                             |
| 05 Explain                | Same decision, citizen view vs auditor trace                                           |
| 06 Withdraw consent       | Officer blocked with 403; audit log shows it                                           |
| 07 Go offline             | Network off mid-claim → saved → reconnect → synced, no duplicate                       |
| 08 Fake SMS / forged CNIC | Seal check, red flags, ELA heatmap                                                     |
| Payments (5 buttons)      | Raast timeout, double click, mule account, self-approval, reconcile — see section 20.1 |
| Kill AI                   | LLM disabled → cases still safe, routed to humans                                      |

## 8. Architecture

```
 ┌──────────────────────── Next.js PWA (Vercel) ────────────┐
 │ Citizen (voice/icons) · Helper · Officer · Admin ·       │
 │ Auditor · Judge Mode · Service worker · IndexedDB        │
 └───────────▲──────────────────────────────────────────────┘
             │ HTTPS + JWT  (idempotency keys)
 ┌───────────┴──────── NestJS API (Fastify adapter) ────────┐
 │ guards: jwt · roles · tenant · consent · throttler       │
 │ cases · decisions · rules · documents · scam · eval      │
 │ helpers · payments · audit (hash chain) · rag            │
 │ Claim Agent (allowlisted tools)                          │
 │ /mock/nadra · /mock/raast · /mock/household · /mock/sms  │
 └──────┬─────────────────┬─────────────────┬───────────────┘
        │                 │                 │
   Supabase Postgres   pg-boss jobs      External AI (free)
   + pgvector          (OCR, forgery,    Groq (LLM, Whisper)
   + Storage           LLM, notify)      Gemini (fallback, embeddings)
                                         Edge TTS · Resend · Langfuse · Sentry
```

**Why it scales:** stateless API (run N copies), slow AI work in queues, idempotent writes, tenant_id + indexes on hot tables. Free tiers are not built for scale, but the architecture is — moving to paid tiers changes config, not code.

### 8.1 NestJS backend design

We use **NestJS on the Fastify adapter** (Nest structure, Fastify speed). Hosted on Render.

**Request pipeline** (every request, in this order):

```
Request
 → ThrottlerGuard       rate limit per user / API key
 → JwtAuthGuard         or ApiKeyGuard for public API (@Public() skips)
 → RolesGuard           @Roles('officer', 'admin')
 → TenantGuard          user can only touch rows of their tenant
 → ConsentGuard         @RequireConsent('income') → 403 CONSENT_WITHDRAWN
 → ZodValidationPipe    body/query validated with shared Zod schemas
 → IdempotencyInterceptor   same Idempotency-Key → same stored response
 → Controller → Service → PrismaService
 → AuditInterceptor     writes hash-chained audit row (actor, action, entity)
 → AllExceptionsFilter  uniform error JSON, logged with request id
```

All guards are registered **globally**, so a route is protected by default; a public route must opt out with `@Public()`. This is our answer to "server-side enforcement of access controls".

**Libraries:**

| Need                          | Package                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Fastify adapter               | `@nestjs/platform-fastify`                                                                |
| Validation + Swagger from Zod | `nestjs-zod` (shared schemas in `packages/shared`) + `@nestjs/swagger`                    |
| Auth                          | `@nestjs/jwt` + `@nestjs/passport` + `passport-jwt`, `argon2`                             |
| Rate limit                    | `@nestjs/throttler`                                                                       |
| Config                        | `@nestjs/config` (Zod-validated env)                                                      |
| Logs                          | `nestjs-pino` (request id on every log line)                                              |
| DB                            | Prisma via a `PrismaService` provider                                                     |
| Jobs                          | `pg-boss` wrapped in a `JobsModule` (workers run in the same app, separate process later) |
| Events inside the app         | `@nestjs/event-emitter` (e.g. `payment.completed` → Haq Receipt)                          |
| Tests                         | Jest (Nest default) + Supertest; Playwright for one end-to-end flow                       |

**Modules** (one folder each, one owner each — fewer merge conflicts):

| Module                                                                                                                                     | Owner |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `AuthModule`, `UsersModule`, `TenantsModule`, `ApiKeysModule`, `AuditModule`, `ConsentModule`, `CasesModule`, `PrismaModule`, `JobsModule` | A     |
| `RulesModule`, `DecisionsModule`, `DocumentsModule` (OCR/forgery), `ScamModule`, `EvalModule`                                              | B     |
| `AgentModule`, `PaymentsModule`, `HelpersModule`, `VoiceModule`, `RagModule`, `JudgeModule`, `MockModule` (nadra, raast, household, sms)   | D     |

The mock services live in `MockModule` with their own API keys and simulated latency/failures, so they are still "behind clean APIs" but need no extra deploy.

## 9. Tech stack and costs (total: PKR 0)

| Layer               | Pick                                                                              | Cost                |
| ------------------- | --------------------------------------------------------------------------------- | ------------------- |
| Language / monorepo | TypeScript, pnpm workspaces                                                       | Free                |
| Frontend            | Next.js + Tailwind + shadcn/ui + Recharts                                         | Free                |
| Offline             | Serwist (service worker) + `idb`                                                  | Free                |
| Backend             | NestJS (Fastify adapter) + `nestjs-zod` + `@nestjs/swagger` + `@nestjs/throttler` | Free                |
| Database            | Supabase Postgres (+ pgvector, Storage) + Prisma migrations                       | Free (500 MB)       |
| Jobs                | pg-boss                                                                           | Free                |
| Auth                | jsonwebtoken + argon2                                                             | Free                |
| Rules               | json-logic-js                                                                     | Free                |
| LLM                 | Groq (Llama 3.3 70B), fallback Gemini Flash                                       | Free (rate-limited) |
| STT                 | Groq Whisper large-v3                                                             | Free (rate-limited) |
| TTS                 | Pre-generated clips + `msedge-tts` (ur-PK voices) + browser fallback              | Free (unofficial)   |
| OCR / CV            | tesseract.js, sharp, exifr, jsQR                                                  | Free                |
| Email               | Resend                                                                            | Free (100/day)      |
| SMS / WhatsApp      | Mocked phone screen                                                               | Free                |
| Observability       | Langfuse, Sentry, pino                                                            | Free tier           |
| Tests               | Jest (Nest default), Supertest, Playwright                                        | Free                |
| Hosting             | Vercel (web), Render (API), GitHub                                                | Free                |

**Free-tier traps:**

| Trap                                                | Fix                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| Render free sleeps after ~15 min (cold start ~50 s) | UptimeRobot ping every 10 min; local backup on a laptop for judging |
| Supabase free pauses after ~1 week idle             | Open dashboard Monday morning                                       |
| Groq rate limits                                    | Each dev uses own key; cache AI results; Gemini fallback            |
| Google Cloud / AWS need a card                      | Avoid them                                                          |

## 10. Data model (Prisma, first version)

| Table                         | Key fields                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`                     | id, name, type (relief / fraud_desk)                                                                                                                        |
| `users`                       | id, tenant_id, role, phone, name, password_hash, pin_hash                                                                                                   |
| `persons`                     | id, cnic_enc, cnic_hash, full_name, name_normalized, father_name, dob, phone_enc, district                                                                  |
| `helper_assignments`          | helper_id, person_id, granted_by, expires_at, revoked_at                                                                                                    |
| `consents`                    | id, person_id, grantee_type, grantee_id, fields[], purpose, status, granted_at, withdrawn_at                                                                |
| `data_access_log`             | person_id, accessor_id, fields[], purpose, allowed, at                                                                                                      |
| `documents`                   | id, case_id, type, storage_key, ocr_json, qr_json, forgery_score, blur_score, flags[]                                                                       |
| `cases`                       | id, tenant_id, person_id, type, status, lane, priority, confidence, assigned_to, created_by, on_behalf_of, idempotency_key                                  |
| `case_events`                 | case_id, actor_type, actor_id, event, data, at                                                                                                              |
| `rule_sets` / `rule_versions` | rule_set_id, version, logic_json, clause_texts, status, created_by, activated_at                                                                            |
| `cost_settings`               | version, wrong_approval, review, ask_more, amount_cap, threshold                                                                                            |
| `decisions`                   | id, case_id, rule_version_id, cost_settings_version, model_version, prompt_version, input_hash, features, confidence, lane, explanation_user, trace         |
| `payments`                    | id, case_id, amount, state (state machine), idempotency_key (unique), end_to_end_id, creditor_alias, title_fetched, title_match_score, maker_id, checker_id |
| `payment_attempts`            | payment_id, attempt_no, request, response, outcome (success / failed / timeout), at                                                                         |
| `ledger_entries`              | id, txn_id, account (fund / payable / beneficiary), debit, credit, payment_id, at (append-only)                                                             |
| `approvals`                   | entity, entity_id, maker_id, checker_id, status, at (maker-checker; maker ≠ checker enforced)                                                               |
| `reconciliation_runs`         | id, date, matched, missing, extra, amount_mismatch, report_json                                                                                             |
| `receipts`                    | payment_id, confirmed_full, reported_amount, at                                                                                                             |
| `messages`                    | id, text, sender, channel, district, seal_valid, label, confidence, red_flags[], lane, reviewed_label                                                       |
| `api_keys`                    | id, owner_id, key_hash, scopes[], rate_limit, revoked_at                                                                                                    |
| `refresh_tokens`              | id, user_id, token_hash, family_id, on_behalf_of, expires_at, revoked_at                                                                                    |
| `audit_logs`                  | id, actor_type, actor_id, action, entity, entity_id, payload_hash, prev_hash, hash, ip, at                                                                  |
| `idempotency_keys`            | key, user_id, response, created_at                                                                                                                          |
| `eval_runs`                   | id, dataset, threshold, metrics_json, at                                                                                                                    |
| `policy_chunks`               | id, doc, section, text, embedding (pgvector)                                                                                                                |

## 11. API routes (first version)

```
POST /auth/login · /auth/refresh · /auth/logout · /auth/pin-switch (helper)
GET  /me
POST /cases                       (idempotency key)     GET /cases · /cases/:id
POST /cases/:id/documents         POST /cases/:id/voice
POST /cases/:id/assign · /escalate · /close · /approve · /reject · /request-info
GET  /queue                       (officer, sorted)
GET  /decisions/:id               /decisions/:id/trace  (auditor)
GET  /consents  POST /consents  POST /consents/:id/withdraw  POST /corrections
GET  /me/data-access-log
POST /scam/check                  GET /scam/stats
GET  /rules  POST /rules/:id/versions  POST /rules/versions/:id/simulate (Digital Twin)
POST /rules/versions/:id/publish  GET/PUT /cost-settings
POST /payments/:caseId            POST /payments/:id/approve (checker)
POST /payments/:id/inquiry        POST /payments/:id/reversal
POST /reconciliation/run          POST /receipts/:paymentId
/mock/raast/title-fetch · /mock/raast/status
GET  /eval/summary  POST /eval/run
POST /rag/ask
GET  /audit  POST /audit/verify-chain
POST /api-keys  DELETE /api-keys/:id
POST /judge/:scenario             (admin, Judge Mode)
POST /tenants (onboarding wizard) GET /tenants/:id/usage
POST /webhooks  GET /webhooks/:id/deliveries  POST /webhooks/deliveries/:id/resend
GET  /health  (public: DB, queue, Groq, mock services; used by UptimeRobot + status badge)
/mock/nadra/verify · /mock/household/:cnic · /mock/raast/transfer · /mock/sms/send
GET  /docs                        (Swagger UI)
```

## 12. Repository structure

```
haqdaar/
├─ apps/
│  ├─ web/            Next.js PWA (all role UIs, Judge Mode)
│  └─ api/            NestJS API (Fastify adapter)
│     ├─ prisma/      schema.prisma + migrations
│     └─ src/
│        ├─ common/   guards, interceptors, filters, decorators
│        └─ modules/  auth, users, tenants, api-keys, audit, consent,
│                     cases, rules, decisions, documents, scam, eval,
│                     agent, payments, helpers, voice, rag, judge,
│                     jobs, mock/{nadra,raast,household,sms}
├─ packages/
│  └─ shared/         Zod schemas + types shared by web and api
├─ data/
│  ├─ generators/     synthetic persons, cases, messages (labelled)
│  ├─ seed/           seed scripts
│  ├─ policy/         mock program policy docs (for RAG)
│  └─ audio/          pre-generated Urdu prompt + number clips
└─ docs/              this plan, PDF, architecture notes
```

## 13. Team split (3 people)

> Status Sat 21 Nov, 4 AM: **the whole backend is built and tested** (7 microservices, 70+ unit tests, 47 e2e worst-case tests, 4 chaos tests). See `docs/ARCHITECTURE.md` and `docs/CONTRACTS.md`. The remaining work is mostly frontend, AI quality and demo.

| Person                               | Owns                                                                                                                                                                                                                                    | Next deliverable                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **A — Umer (backend + integration)** | All 7 services (gateway, identity, cases, ai, payments, audit, rails-mock), Prisma schemas, event bus, security, Judge Mode endpoints, eval/metrics API, deploy (Render + Supabase), CI. Explains architecture + fintech flow to judges | Deploy all services; Judge Mode scenario endpoints; `/eval/summary`  |
| **B — AI quality**                   | Real Groq/Gemini keys, prompt tuning, golden set (50 labelled cases) + calibration (Platt), Urdu Whisper testing, OCR/forgery (tesseract + ELA), RAG over policy docs, Urdu audio clips (Edge TTS)                                      | Golden set passing in CI; real Urdu voice claim extracting correctly |
| **C — Frontend**                     | Next.js PWA: voice-first citizen flow (icons + audio), Helper Mode screens, officer queue, admin rule editor + Digital Twin, auditor trace, mock phone (SMS + Haq Receipt), Judge Mode panel, offline outbox                            | Citizen claim flow end to end against the gateway at `:4000`         |

**Git rules:** branch per feature (`a/...`, `b/...`, `c/...`), small PRs, merge to `main` at least every 4 hours. A owns the Prisma schemas; contracts in `packages/shared` and `docs/CONTRACTS.md` change only with a heads-up. Before every merge: `pnpm build && pnpm test`, and `pnpm e2e` with the stack running.

## 14. 48-hour timeline

| Time (PKT)          | Hours  | Goal                                                                                                                                   |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Fri 6 PM – 9 PM     | H0–3   | Repo + monorepo, Supabase, Prisma v1, hello-world deployed (web + api), env keys, agree shared Zod contracts                           |
| Fri 9 PM – Sat 6 AM | H3–12  | Each person builds their first deliverable. Sleep shifts: A+C sleep 2–6 AM, B+D sleep 6–10 AM                                          |
| Sat 6 AM – 2 PM     | H12–20 | Integrate. **M1 (Sat 2 PM): full happy path deployed** — voice claim → agent → decision → approval → mock payment → receipt            |
| Sat 2 PM – Sun 4 AM | H20–34 | Edge cases (challenges 01–08), Helper Mode, Digital Twin, eval dashboard, Judge Mode. **M2 (Sun 4 AM): every Judge Mode button works** |
| Sun 4 AM – 12 PM    | H34–42 | **Feature freeze at Sun 10 AM.** Bug bash, seed data, tests, offline test on throttled 3G                                              |
| Sun 12 PM – 6 PM    | H42–48 | README (real vs simulated), demo video, slides, final deploy, rehearse 3×. **Submit by 5 PM**                                          |
| Mon 23 Nov          | —      | Warm up Render, open Supabase, local backup running, rehearse once more                                                                |

## 15. Demo script (~6 minutes)

1. **(0:00) The person.** Play Zainab's voice in Urdu asking for help. "She can't read this form. Watch her finish it."
2. **(0:30) Claim by voice** on a throttled connection; CNIC photo; network drops → saved → resumes.
3. **(1:30) Agent at work** (visible step list) → auto-approved at p = 0.993 → mock Raast → **Haq Receipt** plays the amount.
4. **(2:15) The shopkeeper** forwards a fake "relief" SMS → _Not from us_ + red flags; a real one with Seal → _Real_.
5. **(3:00) The helper** switches families with PINs; consent separated; withdraws one family's consent → officer blocked.
6. **(3:45) Hand Judge Mode to the judges.** Messy names, forged CNIC, unsure case, Kill AI.
7. **(4:45) Admin changes a rule** → Digital Twin shows impact → publish → next case uses v2, old shows v1.
8. **(5:30) The numbers:** eval dashboard — cost curve, threshold 0.988, false approvals, false alarms (shown honestly).

## 16. Real vs simulated (for README and judges)

| Real                                           | Simulated                                              |
| ---------------------------------------------- | ------------------------------------------------------ |
| Login, roles, server-side permission checks    | NADRA identity service                                 |
| Rule engine, versioning, Digital Twin          | Raast payments                                         |
| Decision engine, calibration, cost math        | Household / income data exchange                       |
| OCR, QR, forgery heuristics on uploaded images | SMS / WhatsApp delivery (shown on a mock phone screen) |
| Urdu speech-to-text and text-to-speech         | All people, CNICs, documents (synthetic)               |
| Audit hash chain, consent enforcement          | Program policy documents (written by us)               |
| Offline outbox + idempotent sync               | Relief program "Sahara" (fictional)                    |

## 17. Submission checklist

- [ ] Live deployed link (web + API + Swagger)
- [ ] GitHub repository (make public before submission)
- [ ] README: one sentence, features, architecture, real vs simulated, setup, test accounts, limitations
- [ ] Demo video (public Google Drive link)
- [ ] Slides (optional but recommended)
- [ ] "PROTOTYPE — not an official service" label on every page
- [ ] No real personal data anywhere (synthetic only)
- [ ] Local backup running for the live demo
- [ ] CI green on `main` (badge in README), `/health` all green, AI golden-set check passing
- [ ] Rubric scorecard (section 21) walked through: every criterion has its proof ready

## 18. Speed, accuracy, security — why this is the best design

This section is our script for the judges' "why did you choose this?" questions.

### 18.1 Speed

| Where         | What we do                                                                                                                                        | Why it is fast                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API           | NestJS on the **Fastify adapter**                                                                                                                 | Fastify handles about 2× the requests per second of Express; Nest gives structure at no speed cost |
| AI calls      | **Groq** for LLM and Whisper                                                                                                                      | Groq's LPU hardware returns hundreds of tokens per second; Urdu transcription in about 1 s         |
| Slow work     | OCR, forgery checks, LLM, notifications run in **pg-boss jobs**                                                                                   | The API answers in milliseconds; the client polls or gets an in-app notification                   |
| Repeated work | Cache results by input hash (same SMS, same document → same answer, no second AI call)                                                            | Saves time and rate limit                                                                          |
| Database      | Indexes on `cases(tenant_id, status, priority)`, `audit_logs(entity_id)`, `persons(cnic)`, `persons(name_normalized)`; Supabase connection pooler | Officer queue and lookups stay fast as data grows                                                  |
| Phone         | Pages < 100 KB, photos compressed on the phone to ~150 KB, Urdu audio clips ~10 KB cached offline                                                 | Works on 2G/3G; repeat visits load from cache                                                      |
| Decisions     | Rule engine (JSON Logic) and scoring run **in-process**, no AI call                                                                               | A decision takes milliseconds; AI is only used for reading and explaining                          |

**Targets we will measure and show on the evaluation dashboard:** API p95 < 300 ms (excluding AI), scam check < 2 s, full claim decision after upload < 10 s.

### 18.2 Accuracy

Accuracy comes from **design**, not from trusting one model:

1. **Deterministic decisions.** Eligibility is decided by versioned rules, not by an LLM. Same input + same rule version = same result, every time.
2. **Cross-checks instead of single sources.** CNIC number from OCR vs QR code vs mock NADRA must agree; a mismatch is a flag, never ignored.
3. **Structured outputs.** Every LLM output must pass a Zod schema. Invalid → one retry with the error → still invalid → goes to a human. Low temperature (0–0.2) for extraction.
4. **Ensembles for classification.** Scam = seal check + red-flag rules + LLM. The certain layers (seal) handle most cases; the LLM only handles the leftovers.
5. **Calibrated confidence.** Scores are calibrated on a labelled synthetic set, so "0.99" really means ~99% right. We show a reliability chart.
6. **Abstain when unsure.** Accuracy on the cases we decide stays high because uncertain cases go to humans — and we report the automation rate honestly next to it.
7. **Human feedback loop.** Every officer decision is stored as a label (`reviewed_label`) and used in the next evaluation run.

**Targets on our labelled synthetic sets** (shown live, with the dataset described honestly as synthetic):

| Metric                                              | Target                                  |
| --------------------------------------------------- | --------------------------------------- |
| Wrong auto-approvals (fraud approved by the system) | ≤ 0.5% of auto-approved cases           |
| Share of cases decided automatically                | ≥ 60%                                   |
| Scam detection recall                               | ≥ 95%                                   |
| False alarms on genuine messages                    | ≤ 5% (each shown in a list, not hidden) |
| Name matching: wrong merges                         | 0 (never merges on name alone)          |

### 18.3 Security

| Area                   | What we do                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication         | Passwords hashed with **argon2id**; JWT access token 15 min; refresh tokens rotated on each use and stored hashed — a reused old refresh token logs out every session (theft detection)                          |
| Authorization          | **Global guards, deny by default**: JWT → Roles → Tenant → Consent. A new route is protected unless explicitly marked `@Public()`. Checked on the server, never only hidden in the UI                            |
| Tenant isolation       | Every query is scoped by `tenant_id` through a Prisma extension; tests try cross-tenant access and must get 403/404                                                                                              |
| Helper Mode            | Family switch needs that family's PIN (hashed, 5 tries then lock); helper tokens carry `on_behalf_of` and expire; every action logged "helper X for family Y"                                                    |
| Personal data          | CNIC and phone **encrypted at rest** (AES-256-GCM field encryption) with a separate hash for lookups; officers see masked CNIC (`42101-*****-3`) unless consent + need                                           |
| Consent                | `ConsentGuard` checks live consent on every read; withdrawal takes effect on the next request (no cached access); every allowed and denied access is logged                                                      |
| Input                  | Zod validation on every body and query; file uploads limited by size and checked by magic bytes, not file extension; images re-encoded with sharp (strips hidden content)                                        |
| AI safety              | PII removed before prompts; document and SMS text treated as **data, never instructions** (prompt-injection defense); the agent can only call allowlisted tools; `initiate_payment` needs a human approval token |
| API                    | API keys stored hashed with scopes and per-key rate limits; `@nestjs/throttler` on login and public endpoints; Helmet security headers; CORS allowlist; idempotency keys stop replayed payments                  |
| Audit                  | Append-only, **hash-chained** audit log; auditor role is read-only; "Verify chain" button detects any edited row                                                                                                 |
| Seal                   | Program messages signed with HMAC-SHA256 (secret only on the server, rotatable); codes include an expiry                                                                                                         |
| Storage                | Documents in private Supabase Storage; short-lived signed URLs only                                                                                                                                              |
| Secrets & supply chain | Secrets only in environment variables (never in git); `.env.example` only; `pnpm audit` before submission                                                                                                        |

### 18.4 Coverage matrix — every requirement and challenge

**Requirements from the brief:**

| Requirement                | Required                                       | We cover                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User roles                 | ≥ 3                                            | **5** (citizen, helper, officer, admin, auditor)                                                                                                                                  |
| Core platform features     | all 7                                          | **all 7**                                                                                                                                                                         |
| Optional platform features | ≥ 3                                            | **10** (rule editor, officer queue, offline, jobs, rate limiting, multi-tenant, notifications, analytics, signed webhooks, tenant onboarding + usage metering)                    |
| AI features                | ≥ 3                                            | **11** (all of them: voice, structured outputs, classification + routing, computer vision, agent + tools, guardrails, explainability, anomaly detection, evaluation, memory, RAG) |
| Engineering basics         | Postgres + migrations, monitoring, logs, tests | Supabase Postgres + Prisma migrations, Sentry + Langfuse, pino logs, `/health` + UptimeRobot, Jest + Supertest + Playwright, GitHub Actions CI with an AI golden-set check        |
| Bonus features             | optional                                       | **Digital Twin + Helper Mode + Offline-First Sync** (Scam Map if time)                                                                                                            |
| Rules                      | prototype label, mock data, real vs simulated  | Label on every page, synthetic data only, table in README                                                                                                                         |

**The 8 technical challenges:**

| #   | Challenge                | Our mechanism                                                                              | Proof shown live                     |
| --- | ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| 01  | Cost of being wrong      | Cost model → threshold 0.988, hard flags, amount cap, circuit breaker, never auto-reject   | Cost curve + Judge button 01         |
| 02  | Saying "I am not sure"   | Calibrated confidence, abstain → human with AI case note, Kill AI → safe routing           | Judge buttons 02 + Kill AI           |
| 03  | Bad data                 | Normalize + transliteration map + Jaro-Winkler + CNIC rules, never merge on name alone     | Judge button 03 on seeded messy data |
| 04  | Rules that change        | JSON Logic rule versions, instant publish, decisions store rule version, Digital Twin      | Judge button 04                      |
| 05  | Explain and audit        | Urdu voice reason + full auditor trace + hash-chained log                                  | Judge button 05 + Verify chain       |
| 06  | Consent and take-back    | ConsentGuard, withdraw → 403, access log, corrections                                      | Judge button 06                      |
| 07  | Works for everyone       | Voice + icons, < 100 KB pages, offline outbox, idempotent sync                             | Judge button 07 (network off)        |
| 08  | Scams and fake documents | Haqdaar Seal + rules + LLM ensemble, ELA/EXIF/QR/OCR cross-checks, honest false-alarm list | Judge button 08 + eval dashboard     |

## 19. Judge Q&A — prepared answers

| Question                                           | Our answer                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why NestJS?                                        | Global guards make deny-by-default security easy to prove; modules let 4 people work in parallel; Fastify adapter keeps it fast. Our team already knows it, so we spent the time on judgment, not learning.   |
| Why doesn't the AI make the decision?              | LLMs are not reproducible or auditable. Rules decide, so every decision can be replayed with its rule version; the AI reads, sorts and explains.                                                              |
| Why never auto-reject?                             | A wrong rejection stops a real person's money. Automation may only approve when very sure, or escalate. Only a human can say no.                                                                              |
| Why 0.988?                                         | From the cost model: (1 − p) × 25,000 < 300. If the admin changes the costs, the threshold changes with them — no code change.                                                                                |
| Why JSON Logic for rules?                          | Rules are data, not code: editable in the admin UI, versioned, replayable in the Digital Twin, and safe (no code execution).                                                                                  |
| Why Postgres?                                      | Relational data with strict integrity (cases, consents, payments), transactions for payments, pgvector for RAG — one database instead of three.                                                               |
| Why pg-boss instead of Redis queues?               | Jobs live in the same database, inside the same transactions; one less service to run and secure.                                                                                                             |
| Why your own JWT instead of a hosted auth service? | We need helper "on behalf of" tokens, PIN switching and custom audit — easier to control and explain with our own tokens.                                                                                     |
| How do you know your accuracy numbers are real?    | They come from labelled synthetic sets we generated with known answers; we show the dataset, the confusion matrix and every false alarm. We say clearly that real-world accuracy needs real (consented) data. |
| What are the limitations?                          | Synthetic data only; forgery detection is heuristic (it routes to humans, never rejects); free-tier hosting; Urdu TTS uses an unofficial voice service with a browser fallback.                               |

## 20. Know your judges

Our judges: developers from **PaySys Labs** (product-focused), **two from fintech**, and **one serial hackathon winner**. What each will look for, and how we answer it:

| Judge              | What they will test                                                                             | Our answer                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Fintech / payments | Double payments, timeouts, reconciliation, fraud/mule accounts, approvals, audit                | Bank-grade payout flow (20.1)                                             |
| Product            | Is the user journey clear? Is there a real user and a measurable outcome? Polish in the details | One persona, one task, one north-star metric, every state designed (20.2) |
| Hackathon winner   | Does it actually work live? Is the story sharp? Are they overclaiming?                          | Story in 30 seconds, live Judge Mode, honest numbers (20.3)               |

### 20.1 Bank-grade payout flow (for the fintech judges)

The payout is small in our story but it is where fintech judges will dig. We do it properly.

**Payment state machine** (no other transitions allowed; every transition audited):

```
CREATED -> AWAITING_APPROVAL -> APPROVED -> SENT -> SUCCESS
                                   |          |-> FAILED   retry, SAME idempotency key
                                   |          '-> UNKNOWN  timeout -> status inquiry
                                   |                       -> SUCCESS or FAILED
                                   '-> HELD   title mismatch / velocity rule -> officer

SUCCESS -> REVERSAL_REQUESTED -> REVERSED   (maker-checker)
```

| Fintech concern                | What we do                                                                                                                                                              | Priority |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Double payment**             | One idempotency key per payout, unique constraint in DB; mock Raast also dedupes by our reference. Retrying the same request returns the same result                    | P0       |
| **Timeouts**                   | A timed-out payment becomes `UNKNOWN` and is **never retried blindly**. A background job runs a status inquiry against mock Raast first                                 | P0       |
| **Mule / wrong accounts**      | **Account title fetch** before payout (mock Raast alias lookup) → title compared to the beneficiary with our name matcher → mismatch = `HELD` for an officer            | P0       |
| **Maker-checker (four-eyes)**  | Payouts above a limit, reversals and rule publishing need a **second, different** officer/admin to approve. The system blocks self-approval                             | P0       |
| **Velocity / AML-style rules** | Same receiving account for many beneficiaries, many claims from one device/phone, payouts at unusual times → hold + alert. Limits are admin-editable rules              | P1       |
| **Ledger**                     | **Double-entry ledger** (`ledger_entries`): every payout debits the program fund account and credits the beneficiary payable; balances are always derived, never edited | P1       |
| **Reconciliation**             | Daily (on-demand in the demo) job compares our ledger with the mock Raast statement → matched / missing / extra / amount-mismatch report                                | P1       |
| **Standards awareness**        | Mock Raast request fields modelled on ISO 20022 credit-transfer names (end-to-end id, debtor, creditor, amount, currency), since Raast uses ISO 20022                   | P2       |

The mock Raast service can be told to **time out, fail, or return duplicates** so we can show each case live.

**New Judge Mode buttons:**

| Button               | What judges see                                                                        |
| -------------------- | -------------------------------------------------------------------------------------- |
| Raast timeout        | Payment → `UNKNOWN` → status inquiry → `SUCCESS`, paid exactly once                    |
| Double click / retry | Same payout sent 3× → one payment, one ledger entry                                    |
| Mule account         | Payout to an account whose title doesn't match → `HELD` with the reason                |
| Self-approval        | Officer tries to approve their own high-value payout → blocked, needs a second officer |
| Reconcile            | Run reconciliation → one deliberate mismatch found and explained                       |

### 20.2 Product thinking (for the product judges)

- **North-star metric: "time to money"** — from first voice message to Haq Receipt. Shown on the analytics dashboard, with the median for auto-approved vs human-reviewed cases.
- **Supporting metrics:** task completion rate without help, claims finished offline, scams stopped, false alarms, officer minutes saved.
- **Every state is designed:** loading, empty, error, offline, "waiting for officer" — each with an icon and a spoken Urdu line. No raw error messages, ever.
- **One consistent design system:** shadcn/ui, one colour palette, big touch targets (≥ 48 px), Urdu as the first language with English toggle.
- **Clear "what's next" on every screen** for the citizen: one primary action, never a menu.

### 20.3 Winning the room (for the hackathon winner)

- **Open with the person, not the tech:** 30 seconds of Zainab's story and her voice. Then show it working.
- **No dead time:** seeded data, logged-in tabs ready for each role, the demo path rehearsed until it takes 6 minutes flat.
- **Let them drive:** hand over Judge Mode. Confidence that it won't break is the strongest signal.
- **Never overclaim:** say "synthetic data", "heuristic", "mock Raast" out loud before they ask.
- **Have a backup:** the local copy running on a laptop and a recorded video, in case the venue internet fails.
- **Be ready for code questions:** each person can explain their own modules and one trade-off they made.

### 20.4 Extra fintech questions — prepared answers

| Question                                              | Our answer                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What if Raast times out after the money left?         | The payment goes to `UNKNOWN`, never retried blindly. A status inquiry decides it; the idempotency key guarantees one payout even if we resend.        |
| How do you prevent double payment?                    | Idempotency key per payout + unique DB constraint + the provider deduplicating by our reference. Demo: click pay 3 times, one payment.                 |
| How do you stop money going to a fraudster's account? | Account title fetch + name match before payout; mismatch holds the payment for an officer. Velocity rules catch one account receiving for many people. |
| Who can move money?                                   | No single person: maker-checker for high value and reversals; the AI agent can never call the payment tool without a human approval token.             |
| How do you know the books are right?                  | Double-entry ledger; balances are derived, never edited; reconciliation against the provider statement flags every mismatch.                           |

## 21. Evaluation rubric — our scorecard (100 points)

The official rubric, criterion by criterion, with **what proves it, where judges see it, and who owns it**. Use this as the final checklist on Sunday and as the order of the demo.

**Where the points are:** AI 30 · SaaS 20 · Real-world 15 · Safety 15 · Accessibility 10 · Innovation 10. AI + SaaS = **half the marks**, so roles B (AI) and A (backend) carry the most weight; accessibility and innovation are where our story already shines.

### 21.1 AI Implementation & Intelligence (30)

| Criterion                       | Pts | Our proof                                                                                                                                                                                       | Shown where                       | Owner |
| ------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----- |
| Functional AI features (≥ 3)    | 12  | **5 flawless "headline" AI features** (below), the other 6 as support                                                                                                                           | Main demo steps 2–4 + Judge Mode  | B, D  |
| AI workflow integration         | 8   | AI is inside **one pipeline**, not bolted-on chatbots: voice → structured claim → document vision → agent tools → rules decide → AI explains. Each AI step feeds the next                       | Agent step list visible on screen | B     |
| AI output quality & consistency | 6   | Zod-validated outputs, temperature 0–0.2, **versioned prompts**, input-hash cache (same input → same answer), **golden set of 50 labelled cases run in CI** — the build fails if accuracy drops | Eval dashboard + CI badge         | B     |
| Model & tool selection          | 4   | Every model chosen for a reason (table below) and a fallback for each                                                                                                                           | Slide + Q&A                       | B     |

**The 5 headline AI features** (must never fail in the demo; everything else is a bonus):

1. **Urdu voice claim:** Whisper STT → LLM fills the claim schema → Urdu voice reply.
2. **Document vision:** CNIC OCR + QR + forgery checks (ELA, EXIF, OCR vs QR vs NADRA).
3. **Scam classifier:** Seal + red-flag rules + LLM, with confidence and routing.
4. **Claim Agent:** visible tool calls, with a human approval token required for payment.
5. **Explainability:** a 1–2 sentence Urdu reason for the citizen and a full trace for the auditor.

**Model & tool choices (say these out loud):**

| Job                                | Choice                           | Why                                            | Fallback             |
| ---------------------------------- | -------------------------------- | ---------------------------------------------- | -------------------- |
| Urdu speech-to-text                | Groq Whisper large-v3            | Best open model for Urdu; ~1 s on Groq         | Gemini audio         |
| Reasoning, extraction, explanation | Llama 3.3 70B on Groq            | Fast, free, strong at structured JSON          | Gemini Flash         |
| OCR                                | tesseract.js (on our server)     | CNIC images never leave our system (privacy)   | Officer manual entry |
| Forgery                            | sharp ELA + exifr + jsQR         | Deterministic and explainable, not a black box | Human review         |
| Eligibility decision               | JSON Logic rules, **not an LLM** | Reproducible, auditable, versioned             | —                    |
| Confidence                         | Platt-scaled scores              | "0.99" really means ~99% right                 | Abstain → human      |

### 21.2 SaaS Functionality & Technical Architecture (20)

| Criterion                          | Pts | Our proof                                                                                                                                                                                                | Shown where                             | Owner |
| ---------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----- |
| Core SaaS features & functionality | 8   | 5 roles + RBAC, **multi-tenant** (2 tenants + "Launch a program" wizard), per-tenant analytics, **usage metering + quota**, API keys, **signed webhooks**, notifications, admin rule editor              | Admin tour (60 s)                       | A, C  |
| Backend architecture & API design  | 5   | NestJS modules, global deny-by-default guards, uniform error format, idempotency, versioned REST, **Swagger at `/docs`**, queues for slow work                                                           | Swagger page + architecture slide       | A     |
| Database design & data management  | 4   | Normalised Prisma schema, Prisma migrations, indexes on hot paths, encrypted PII fields, double-entry ledger, append-only hash-chained audit, seed scripts                                               | ER diagram slide                        | A     |
| Deployment, testing & monitoring   | 3   | Live on Vercel + Render; **GitHub Actions CI** (lint, typecheck, Jest, Supertest, golden-set AI check); Playwright happy path; Sentry errors, Langfuse AI traces, pino logs; **`/health`** + UptimeRobot | CI badge, Sentry + Langfuse screenshots | A, D  |

### 21.3 Real-World Problem Solving (15)

| Criterion                          | Pts | Our proof                                                                                                                         | Owner                |
| ---------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Problem understanding & user needs | 5   | One persona (Zainab), her 3 real barriers (can't read, weak signal, scam messages), plus the helper, officer and shopkeeper views | Everyone (the pitch) |
| End-to-end task completion         | 7   | **The single most important item.** From voice to money to receipt, live, in under 2 minutes, with no manual DB edits             | All (M1 milestone)   |
| Practical impact & relevance       | 3   | "Time to money", officer minutes saved, scams stopped — numbers on the dashboard; mapped to real Pakistani rails (NADRA, Raast)   | C                    |

### 21.4 Accessibility & Inclusion (10)

| Criterion                    | Pts | Our proof                                                                                                       | Owner |
| ---------------------------- | --- | --------------------------------------------------------------------------------------------------------------- | ----- |
| Voice & regional language    | 4   | Urdu voice in and out; every screen has a play button; amounts spoken offline from number clips; English toggle | D, C  |
| Low-literacy usability       | 3   | Icons + colour + audio, one action per screen, ≥ 48 px targets, Helper Mode                                     | C     |
| Weak internet & connectivity | 3   | < 100 KB pages, compressed photos, offline outbox + idempotent sync; demo with network **off**                  | D     |

### 21.5 Safety, Privacy & Reliability (15)

| Criterion                          | Pts | Our proof                                                                                                                            | Owner |
| ---------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| AI uncertainty & human handoff     | 5   | Calibrated confidence, 3 lanes, never auto-reject, AI case note for the officer, **Kill AI** button                                  | B     |
| Privacy, consent & data protection | 4   | ConsentGuard (withdraw → 403 instantly), encrypted CNIC/phone, masking, PII stripped before prompts, data-access log for the citizen | A     |
| Explainability & auditability      | 3   | Urdu reason + auditor trace with rule version; hash-chained audit with "Verify chain"                                                | A, B  |
| Risk handling & system reliability | 3   | Circuit breaker, retries with backoff, Raast `UNKNOWN` → status inquiry, maker-checker, rate limits, AI fallback models              | A, D  |

### 21.6 Innovation & Creativity (10)

| Criterion                               | Pts | Our proof                                                                                                                          |
| --------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Originality & uniqueness                | 4   | **Haqdaar Seal** (proving "real" instead of guessing "fake") and **Haq Receipt** (spoken payout amount against middlemen skimming) |
| Creative feature implementation         | 4   | **Judge Mode** (judges break it live), **Digital Twin** (replay past cases on a new rule), Helper Mode with PIN switching          |
| Technical creativity & design decisions | 2   | Cost-based threshold (0.988 from the maths, not a guess), rules-decide / AI-explains split                                         |

### 21.7 Where we could lose points (and the fix)

| Risk                                  | Criterion hit            | Fix                                                                                                |
| ------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| Groq rate limit or outage during demo | AI features (12)         | Gemini fallback + cached answers for the seeded demo inputs + Kill AI path still finishes the task |
| Too many half-working features        | AI quality (6), E2E (7)  | Feature freeze Sun 10 AM; the 5 headline AI features first, others only if green                   |
| "It's a public service, not SaaS"     | Core SaaS (8)            | Show multi-tenant onboarding, usage/quota, API keys, webhooks in a 60-second admin tour            |
| No visible tests / monitoring         | Deploy & test (3)        | CI badge in README, show one Sentry error and one Langfuse trace                                   |
| Render cold start                     | Reliability (3), E2E (7) | Warm up 10 min before, UptimeRobot, local backup                                                   |

**Demo order follows the points:** end-to-end task (E2E 7 + AI 12) → Judge Mode (Safety 15) → admin tour (SaaS 8) → eval dashboard + CI (AI quality 6 + testing 3).
