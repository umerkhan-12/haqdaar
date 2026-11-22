# Coverage: the brief, line by line

> **PROTOTYPE ONLY — not an official government service.** Every identity, payment, SMS and data service is simulated. All people are synthetic.

This page maps every line of the official brief ("The Last Mile: AI on Public Rails") and every rubric criterion to what is built, where a judge can see it, and where it lives in code.

**Status words**

- **Done**: works end to end in `main`.
- **Partial**: works, with a stated gap.
- **Not built**: not there, with the reason.
- `<!-- STATUS: pending merge -->` marks a feature that is being merged while this page is written. The lead removes the marker (or changes the row) once it is in `main`.

**How to reach the screens.** Open the app, tap a demo account on the login page (password `demo1234`). Admin pages are in the top bar: Rules, AI, Money, Evaluation, Programs, API keys, Webhooks, API docs, Judge Mode, Mock phone.

---

## 1. Constraints (8)

| # | Constraint | Status | Where a judge sees it | Code |
| - | ---------- | ------ | --------------------- | ---- |
| 1 | Wrong approvals cost more than slow approvals | Done | Admin > Rules > "Cost of being wrong": three costs and the live threshold `1 − review ÷ wrong approval` (25,000 and 300 give 0.988). Admin > Evaluation > "Run evaluation now" shows cost per case against all-human. | `packages/shared/src/domain.ts` (`autoApproveThreshold`), `services/cases/src/engine/decide.ts`, `services/cases/src/eval/` |
| 2 | Weak internet | Done | Citizen > "Claim my money" with the network off: the claim is saved on the phone, the amber banner counts waiting claims, it is sent once when the signal returns. | `apps/web/lib/outbox.ts`, `apps/web/public/sw.js`, idempotency in `services/cases/src/cases/cases.service.ts` |
| 3 | Low literacy | Done | Citizen screens: every step speaks in Urdu by itself, one big microphone button, icons for the four steps, yes / no buttons, speaker button on every line. | `apps/web/features/citizen/`, `apps/web/lib/voice.ts`, `apps/web/public/audio/` (194 recordings) |
| 4 | Rules change without notice | Done | Admin > Rules: change a threshold, "Run Digital Twin", "Publish v2…". The next claim uses v2; no deploy. | `services/cases/src/rules/rules.service.ts`, `services/cases/src/engine/rules.ts` |
| 5 | Bad data | Done | Judge Mode > "Bad data (messy names, same names)" > Run. Shows name scores and that two Zainab Bibis are not merged. | `services/cases/src/engine/names.ts`, `services/rails-mock/src/names.ts`, `services/cases/src/engine/decide.ts` (`sanitize`) |
| 6 | Explainable decisions | Done | Citizen: spoken Urdu reason on the result and status screens. Officer: "Decision" card with each rule clause met / not met. Auditor > Audit log > Open > "Decision trace". | `decide.ts` (explanations), `apps/web/features/auditor/trace-view.tsx`, `GET /decisions/:id/trace` |
| 7 | User control of data | Done | Citizen > "My data and permission": who sees what and why, "Take back", "Give again", "My information is wrong". | `apps/web/features/citizen/consents.tsx`, `services/identity/src/consents/` |
| 8 | "I am not sure" | Done | Any claim the engine is not sure about shows "An officer is checking it" and says "a person will decide, not a machine". It appears in Officer > Queue with the notes. | `decide.ts` (lanes), `services/cases/src/cases/ai-notes.ts`, `apps/web/features/officer/` |

## 2. User roles (5; the brief asks for at least 3)

| Role | Status | Where a judge sees it | Code |
| ---- | ------ | --------------------- | ---- |
| Citizen | Done | Login as "Citizen — Zainab". Four cards: Claim my money, Where is my money?, Is this message real?, My data and permission. Self sign-up from the login page ("Create a new account"). | `apps/web/features/citizen/`, `apps/web/features/auth/signup.tsx` |
| Community helper | Done | Login as "Helper — shopkeeper Asif". Pick a family, enter that family's 4-digit PIN, then act for it. "Switch family" in the banner. | `apps/web/features/helper/families.tsx`, `services/identity/src/auth/auth.service.ts` (`actFor`) |
| Department officer | Done | Login as "Officer — Sana" or "Officer — Kamran". Queue (sort by priority, lowest confidence, longest waiting), case panel, Payments. | `apps/web/features/officer/`, `services/cases/src/cases/cases.controller.ts` |
| Admin | Partial | Login as "Admin — Hira". Rules, AI controls, money, evaluation, programs, API keys, webhooks, API docs, Judge Mode, mock phone. **Gap:** there is no screen to add or edit individual users and roles; an admin can launch a program with its first admin, and other accounts come from the seed or sign-up. | `apps/web/features/admin/`, `services/identity/src/tenants/` |
| Auditor | Done | Login as "Auditor — Bilal". Audit log (read-only, hash chain check), decision trace, Evaluation. Write routes answer 403. | `apps/web/features/auditor/`, `services/audit/src/` |

A sixth role, `partner`, exists only for API-key clients (banks, telcos).

## 3. Core platform features (7, all required)

| Feature | Status | Where a judge sees it | Code |
| ------- | ------ | --------------------- | ---- |
| Secure login (JWT) with role-based access control | Done | Login page. Wrong role on a page sends you to your own home; the API answers 401 / 403. RS256 tokens, refresh rotation with reuse detection, argon2id passwords and PINs, lock after 5 failures. Every service verifies the token itself. | `services/identity/src/auth/`, `packages/nest-kit/src/auth/` |
| Dashboard with task progress, status and history | Done | Citizen > "Where is my money?": status card, timeline, list of all claims. Officer > Queue. Admin > Evaluation > live numbers for this program. | `apps/web/features/citizen/status.tsx`, `apps/web/features/admin/eval.tsx`, `GET /eval/summary` |
| Case management (create, assign, escalate, close) | Done | Officer case panel: Approve, Reject…, Ask for info…, Assign to me, Escalate…, Close case…. Each one lands on the timeline and in the audit log. | `services/cases/src/cases/` |
| Public REST API with API keys and documentation | Partial | Admin > API keys: create a key (shown once), revoke. Admin > API docs: Swagger for every service through the gateway (`/docs/:service`) and the partner flow. **Gap:** one partner route works today, `POST /ai/scam-check` (scope `scam:check`). The scope `cases:status` can be put on a key but no route accepts it yet. | `services/identity/src/api-keys/`, `services/gateway/src/docs.controller.ts`, `apps/web/features/admin/docs.tsx` |
| Audit log of every user, AI and agent action | Done | Auditor > Audit log: every event with actor and hash; "Verify chain" button. AI calls are logged as `ai.call.completed`. | `services/audit/src/` (`chain.ts`), `packages/shared/src/events.ts` |
| Consent management (see, share, withdraw, correct) | Done | Citizen > "My data and permission". Withdrawal blocks officers and admins on the next request (403 `CONSENT_WITHDRAWN`). A correction is a request to staff; the citizen cannot edit her own identity. | `services/identity/src/consents/`, `services/cases/src/cases/cases.service.ts` (`requireConsent`) |
| Mock identity, payment and data services behind clean APIs | Done | Admin > API docs > rails-mock. Judge Mode > "Break a public rail" injects Raast faults. | `services/rails-mock/src/`, `docs/CONTRACTS.md` |

## 4. Optional platform features (10; the brief asks for at least 3)

| Feature | Status | Where a judge sees it | Code |
| ------- | ------ | --------------------- | ---- |
| Multi-tenant workspaces | Done | Admin > Programs: two seeded programs (relief, fraud desk), "Launch a program". The tenant comes from the token, never from the request. | `services/identity/src/tenants/` |
| Admin rule editor | Done | Admin > Rules. The screen edits the amount and every number inside the live rule; the API (`POST /rules/versions`) accepts whole JSON Logic clauses. Adding a new clause is API-only. | `apps/web/features/admin/rules.tsx`, `services/cases/src/rules/` |
| Notifications | Partial | Admin > Mock phone: the SMS a family receives (sign-up code, sealed Haq Receipt). In-app: the citizen's status timeline. **Not built:** WhatsApp and email. SMS is on a simulated rail, so there was nothing real to send them through. | `services/payments/src/receipts/`, `services/rails-mock/src/rails.controller.ts` |
| Webhooks | Done | Admin > Webhooks: register a URL, see delivery attempts, resend. Bodies are HMAC-signed with a timestamp. | `services/payments/src/webhooks/`, `services/payments/src/domain/webhook-signature.ts` |
| Analytics dashboard per tenant | Done | Admin > Programs: requests per day and quota used. Admin > Evaluation: lanes, queue age, time to money for this program. | `services/gateway/src/usage-meter.ts`, `services/cases/src/eval/eval.service.ts` |
| Officer review queue with priority and confidence sorting | Done | Officer > Queue: three sort buttons; escalated cases get priority ×3. No names or CNICs in the list. | `apps/web/features/officer/queue.tsx`, `services/cases/src/engine/priority.ts` |
| Subscription plans and usage limits | Partial | Admin > Programs > "Plan and usage limits": a monthly request quota per program and percent used. **Not built:** subscription billing. A relief program has no paying subscribers, so plans are modelled as per-program usage limits instead. The quota is reported, not enforced. | `services/identity/src/tenants/` |
| Background jobs and queues | Done | Not a screen: events go through a transactional outbox into pg-boss queues (retries, dead letter). Visible effect: a decision becomes a payout, an SMS and an audit entry without the request waiting. `pnpm chaos` kills services mid-flow and nothing is lost. | `packages/nest-kit/src/events/`, `services/*/src/events.consumer.ts` |
| Rate limiting and error handling | Done | Thirteen fast logins for one phone give 429. Every error has `{ statusCode, error, message, requestId }`; citizens never see a raw error. | `services/gateway/src/proxy.ts`, `services/identity/src/login-throttler.guard.ts`, `packages/nest-kit/src/http/` |
| Low-bandwidth or offline mode | Done | See constraint 2. Recorded Urdu prompts are cached by the service worker, so the app also speaks with no signal. | `apps/web/public/sw.js`, `apps/web/lib/outbox.ts` |

## 5. AI features (11; the brief asks for at least 3)

| AI feature | Status | Where a judge sees it | Code |
| ---------- | ------ | --------------------- | ---- |
| RAG with sources | Pending <!-- STATUS: pending merge --> | "Ask about the program": answers only from the synthetic policy documents, shows the source for every sentence, refuses anything outside them. | `services/knowledge/` (port 4008), `docs/policy/`, `docs/KNOWLEDGE.md` |
| Autonomous agents + tool calling | Pending <!-- STATUS: pending merge --> | A read-only assistant (`POST /ai/assist`) that calls tools to look things up and cannot change anything. Until it lands: the claim pipeline (consent, mock NADRA, household, duplicates, rules) is fixed code, not an LLM agent. We say so. | `services/ai/src/`; pipeline in `services/cases/src/cases/cases.service.ts` (`process`, `gather`) |
| Classification and routing | Done | Citizen > "Is this message real?": verdict (Genuine / Scam / Not sure), confidence, reasons. Claims are routed to one of three lanes: auto-approve, ask more, human review. | `services/ai/src/tasks/scam-check.ts`, `services/cases/src/engine/decide.ts` |
| Computer vision | Done | Claim > "Start with a photo of my CNIC": reads the number and name from the card, decodes the QR, checks for edited regions, editing software, blur and expiry. A blurry photo asks for a retake; anything doubtful goes to an officer. Officer sees every check in "AI notes". | `services/ai/src/vision/` |
| Voice | Done | Claim screen: tap the microphone and speak Urdu. Every screen speaks Urdu. | `POST /ai/transcribe`, `POST /ai/speak` (`services/ai/src/speech/speech.ts`), `apps/web/lib/voice.ts` |
| Structured outputs | Done | Not a screen: every model answer is validated against a Zod schema, repaired once, otherwise treated as "not sure". Visible in the officer's "What the AI heard" card. | `services/ai/src/tasks/structured.ts`, `services/ai/src/tasks/extract-claim.ts` |
| Guardrails + human approval | Done | The model never decides money. CNICs and phone numbers are removed before any prompt. AI notes from the phone can only add caution. The first claim from a new self-registered account always goes to an officer. Admin > AI > "Kill AI…". | `services/ai/src/tasks/pii.ts`, `services/cases/src/cases/ai-notes.ts`, `services/ai/src/tasks/explain.ts` |
| Explainability | Done | See constraint 6. Reasons are built from the rule clauses that passed or failed, in Urdu and English. `POST /ai/explain` rewrites them into one or two spoken sentences and falls back to the template if it adds a number or contradicts the lane. **Gap:** the web app reads out the engine's own text today; `/ai/explain` is reachable through the API but no screen calls it yet. | `decide.ts`, `services/ai/src/tasks/explain.ts` |
| Anomaly detection | Partial; fraud-ring part pending <!-- STATUS: pending merge --> | Done today: one account collecting payouts for more than two other people in 24 hours is held (Judge Mode > "Payout to a fraudster (mule) account" shows the related title check). Landing: fraud-ring signals across claims (shared payout account, helper velocity, household pattern, identity collision) that only add a flag for an officer. | `services/payments/src/domain/velocity.ts`; `services/cases/src/engine/anomaly.ts`, `docs/ANOMALY_SIGNALS.md` |
| Memory and context | Partial | Start a voice claim, close the tab, open it again: "The details you gave earlier were saved. Continue from where you stopped." Kept for 24 hours. **Gap:** it is stored on the phone only, so it does not follow her to another device. | `apps/web/features/citizen/claim-flow.tsx` (draft), `apps/web/lib/outbox.ts` |
| Evaluation dashboard | Done | Admin or Auditor > Evaluation: wrong auto-approvals, false alarms by reason, routing accuracy, cost per case, calibration table, queue age, time to money, AI calls, failures, fallbacks and latency per provider. AI spend in dollars is not on the dashboard; `pnpm eval:ai` prints token counts and an estimate. | `apps/web/features/admin/eval.tsx`, `services/cases/src/eval/`, `docs/EVAL_AI.md` |

## 6. Engineering basics (3)

| Item | Status | Evidence | Code |
| ---- | ------ | -------- | ---- |
| Database with migrations (Postgres) | Partial | PostgreSQL, one schema per service, Prisma schema files. Tables are created with `prisma db push` (also on first boot of the container). **Gap:** there are no versioned migration files; in 48 hours with one owner of every schema we pushed the schema directly. | `services/*/prisma/schema.prisma`, `infra/` |
| Deployed link | Done | <https://172-198-74-124.sslip.io> (Azure, India South Central). | `Dockerfile.allinone`, `deploy/vps/`, `docs/DEPLOY.md` |
| Monitoring, logs and basic tests | Done | Gateway `/status` shows every service; each service has `/health`; structured logs with a request id on every line; unit, property, end-to-end, chaos, load and fuzz tests; CI on every push. No external alerting. | `packages/nest-kit/src/health.ts`, `.github/workflows/ci.yml`, `docs/TESTING.md` |

## 7. Technical challenges (8)

Each has a button in **Admin > Judge Mode** that drives the real system through the public API and prints every step.

| # | Challenge | Status | Where a judge sees it | Code |
| - | --------- | ------ | --------------------- | ---- |
| 01 | The cost of being wrong | Done | Judge Mode > "Cost of being wrong". Admin > Rules > cost model. Admin > Evaluation > cost per case. Rule: act alone only when `(1 − p) × 25,000 < 300`, so `p ≥ 0.988`, no hard flag, rule met, amount within the cap (PKR 15,000). Ask more when something is missing. Everything else goes to a human. Automation never rejects. | `decide.ts`, `services/cases/src/eval/evaluate.ts` |
| 02 | Saying "I am not sure" | Done | Judge Mode > 'Saying "I am not sure" (Kill AI)'. Officer > Queue > a case > "AI notes": what the AI heard, what failed, why the case needs care. | `ai-notes.ts`, `apps/web/features/officer/ai-notes-card.tsx` |
| 03 | Bad data | Done | Judge Mode > "Bad data (messy names, same names)". Twelve spellings of Muhammad match; Majid / Sajid do not; people are keyed by CNIC and never merged on a name. Known limit: one slip in a long name (Tahir / Tahira) still matches. | `names.ts`, `names.property.test.ts` |
| 04 | Rules that change | Done | Judge Mode > "Rules that change (Digital Twin)". Admin > Rules. An older case still says "Decided under rule v1". | `rules.service.ts` (`publish`, `simulate`) |
| 05 | Explain and audit | Done | Judge Mode > "Explain and audit". Auditor > Audit log > Open: claim as stated, identity record, household record, evidence behind the score, confidence against threshold, rule clauses, AI calls. | `trace-view.tsx`, `services/cases/src/rules/rules.controller.ts` |
| 06 | Consent and take-back | Done | Judge Mode > "Consent and take-back". By hand: citizen takes back the NADRA permission, the officer's next click on her case is refused, the auditor sees `identity.consent.withdrawn`. | `consents/`, `cases.service.ts` (`requireConsent`), `events.consumer.ts` |
| 07 | Works for everyone | Done | Judge Mode > "Works for everyone (weak network)": the same claim sent five times is filed once. Citizen flow: voice, icons, saved progress, offline outbox. | `claim-flow.tsx`, `outbox.ts`, `sw.js` |
| 08 | Scams and fake documents | Done | Judge Mode > "Scams and fake messages (Haqdaar Seal)". Mock phone > "Is this real?". Claim with the tampered specimen card (see `docs/demo/specimen-cnic.md`). False alarms are on the Evaluation page and in `docs/TESTING.md`. | `packages/nest-kit/src/seal.ts`, `scam-check.ts`, `services/ai/src/vision/forensics.ts` |

Five more buttons under "Bank-grade payouts": Raast times out after taking the money, double click / retry storm, mule account, four eyes, reconciliation.

## 8. Bonus features (4)

| Bonus | Status | Where a judge sees it | Code |
| ----- | ------ | --------------------- | ---- |
| Digital Twin | Done | Admin > Rules > "Run Digital Twin": replays the stored inputs of up to 200 recent automated decisions under the draft rule and lists which would change, before publishing. | `rules.service.ts` (`simulate`) |
| Helper Mode | Done | Helper login > pick a family > PIN. Five wrong PINs lock that family for 15 minutes. Consents are per family. Every action is recorded as the helper acting for that person. | `families.tsx`, `auth.service.ts` |
| Offline-First Sync | Done | See constraint 2. One idempotency key per claim: resending never creates a second case. | `outbox.ts`, `cases.service.ts` |
| Scam Map | Pending <!-- STATUS: pending merge --> | A view of scam patterns by type and time, built from classified messages. | — |

## 9. Rules of the brief and submission items

| Item | Status | Evidence |
| ---- | ------ | -------- |
| Mock all identity, payment and data services; no real personal data | Done | `services/rails-mock/`; every person is synthetic (`docs/CONTRACTS.md`); specimen cards are stamped "NOT A REAL CNIC". |
| Label as a prototype | Done | Amber banner on every page; first line of the README. |
| Tell the judges what is real and what is simulated | Done | [`docs/REAL_VS_SIMULATED.md`](REAL_VS_SIMULATED.md) |
| Functional prototype and live demo | Done | Deployed link above; script in [`docs/DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |
| Code repository | Done | This repository (make it public before submission). |
| README | Done | [`README.md`](../README.md) |
| Demonstration video (public Google Drive link) | To add | Link goes in the README under "Submission". |
| Presentation slides (optional) | To add | Optional. |

---

## 10. Rubric: 6 categories, 20 criteria, strongest evidence

| Category | Criterion (points) | Strongest evidence |
| -------- | ------------------ | ------------------ |
| **01 AI Implementation & Intelligence (30)** | Functional AI features, at least 3 (12) | Eight working today: Urdu speech to text, Urdu text to speech, CNIC vision checks, scam classification, structured extraction, guardrails, explanations, evaluation dashboard. Three more landing (RAG, tool-calling assistant, fraud-ring signals). |
| | AI workflow integration (8) | One task, one chain: speech → extraction → card check → rule engine → lane → officer notes → payout → spoken receipt. The AI's notes travel with the case to the officer. |
| | AI output quality and consistency (6) | Zod-validated outputs with one repair; versioned task names (`scam_check@v1`); calibrated confidence (Platt scaling, refit checked in CI); golden-set gates in CI; `pnpm eval:ai` on 50 transcripts and 40 messages. |
| | Model and tool selection (4) | The table of choices and reasons in `docs/REAL_VS_SIMULATED.md`: document images stay on the server (Tesseract), Whisper large-v3 for Urdu, a free neural Urdu voice with recordings and a fallback, provider chain with circuit breakers and a hard spend cap. |
| **02 SaaS Functionality & Technical Architecture (20)** | Core SaaS features and functionality (8) | Section 3 above: all seven core features, six of ten optional ones done and three partial. |
| | Backend architecture and API design (5) | Nine services behind a gateway, each verifying tokens itself; transactional outbox and pg-boss; Zod contracts shared with the web app; Swagger per service. `docs/ARCHITECTURE.md`. |
| | Database design and data management (4) | One schema per service, no cross-schema reads; CNIC and phone encrypted (AES-256-GCM) with an HMAC hash for lookup; double-entry ledger; append-only audit chain. Gap stated: `db push`, no migration history. |
| | Deployment, testing and monitoring (3) | Live link; CI; 115,560 generated property cases; `pnpm e2e`, `pnpm chaos`, `pnpm load`, `pnpm fuzz`; `/status` and `/health`. |
| **03 Real-World Problem Solving (15)** | Problem understanding and user needs (5) | One sentence, one person, one task. The widow, the shopkeeper and the helper from the brief all touch the same claim. |
| | End-to-end task completion (7) | Voice claim → approved → mock Raast payout → sealed SMS → Haq Receipt spoken, in one sitting. The unsure path ends with an officer's decision, not a dead end. |
| | Practical impact and relevance (3) | Haq Receipt (she hears the exact amount), Haqdaar Seal (real is proven, not guessed), time to money on the dashboard. |
| **04 Accessibility & Inclusion (10)** | Voice and regional language support (4) | Urdu in and out. 194 recorded prompts, server voice for sentences with her own details, phone voice as last resort. |
| | Low-literacy usability (3) | The screen speaks first; asks only for what is missing; reads everything back; yes / no; the card photo fills name and number. |
| | Weak internet and connectivity handling (3) | Service worker, IndexedDB outbox, idempotency key, saved draft. Judge Mode challenge 07. |
| **05 Safety, Privacy & Reliability (15)** | AI uncertainty and human handoff (5) | Three lanes; automation never rejects; the model never approves; Kill AI; first claim of a new account always goes to an officer. |
| | Privacy, consent and data protection (4) | Take-back that blocks staff on the next request; PII redaction before prompts; encrypted CNIC and phone; masked values on staff screens; images never sent to an outside model. |
| | Explainability and auditability (3) | Urdu reason for the citizen, clause-by-clause view for the officer, full trace and hash-chained log for the auditor. |
| | Risk handling and system reliability (3) | Payment state machine (UNKNOWN is never re-sent blindly), title fetch, maker-checker, reconciliation, fault injection, chaos tests. Open findings are listed in `docs/TESTING.md`. |
| **06 Innovation & Creativity (10)** | Originality and uniqueness of approach (4) | Haqdaar Seal: an HMAC code on every genuine message, so "real" is a proof and the AI only handles the leftovers. |
| | Creative feature implementation (4) | Judge Mode with fault injection; Digital Twin; Helper Mode; Haq Receipt. |
| | Technical creativity and design decisions (2) | A threshold derived from costs an admin can change; caution-only AI notes; property tests that found and fixed eight real defects before the demo. |
