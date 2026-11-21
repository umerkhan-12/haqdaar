# Service contracts

The agreed interfaces between services. Change a contract only with a heads-up to everyone who uses it.
Events and their payload schemas live in `packages/shared/src/events.ts` (validated on publish).

## knowledge (port 4008)

| Route | Who | Request / response |
|---|---|---|
| `POST /knowledge/ask` (gateway prefix `/knowledge`) | citizen, helper, officer | Request `{ question: string }`, max 1,200 characters. Response `{ answer: string, citations: [{ docId, heading, quote }], refused: boolean }`. Every answer sentence is an exact quote from a returned policy chunk; unsupported questions return a fixed bilingual refusal with no citations. |

The service owns the `knowledge` schema. It retrieves at most four policy chunks and never reads another service's schema. `/ai/embed` and `/ai/answer-from-sources` are internal-only service calls. The latter returns extractive quotes validated against the supplied chunks. Policy text is untrusted data. The corpus is synthetic prototype guidance, not a real benefits determination. See [docs/KNOWLEDGE.md](KNOWLEDGE.md) for setup and model/index compatibility.

## Synthetic reference data (shared by all seeds)

| Who | Person id | CNIC | Phone (Raast alias) | Account (IBAN) | Account title |
|---|---|---|---|---|---|
| Zainab Bibi (widow, Thatta, household 5, income 18,000) | `10000000-0000-4000-8000-000000000001` | `42201-1234567-4` | `03001110001` | `PK36SAHA0000001234567890` | `ZAINAB BIBI` |
| Rashida Begum (Karachi West, household 7, income 22,000) | `10000000-0000-4000-8000-000000000002` | `42201-7654321-2` | `03001110007` | `PK52SAHA0000007654321098` | `RASHIDA BEGUM` |
| Mule account (fraud demo) | — | — | `03009990000` | `PK11MULE0000009999999999` | `MUHAMMAD ASLAM` |

**Helper families** (helper `03001110002` acts for each with its PIN; used by Judge Mode):

| Family | Person id | CNIC | Alias | PIN | Why it is in the demo |
|---|---|---|---|---|---|
| Zainab Bibi | `…0001` | `42201-1234567-4` | `03001110001` | 1111 | Happy path |
| Rashida Begum | `…0002` | `42201-7654321-2` | `03001110007` | 2222 | Consent, payout faults |
| Nasreen Bi Bi | `…0003` | `42401-3344556-6` | `03451234504` | 3333 | Eligible widow (cost of being wrong) |
| Kaneez Fatima | `…0004` | `42101-6677889-4` | `03151234506` | 4444 | Says "Kaneez Fatma"; outside program districts → human, never rejected |
| Zainab Bibi (Badin) | `…0005` | `41201-4455667-2` | `03121234501` | 5555 | Same name as Zainab, different person: never merged |
| Mohammad Akram | `…0006` | `41101-5566778-3` | `03331234503` | 6666 | Spelling variants of Muhammad |
| Ghulam Rasool | `…0007` | `44201-9988776-5` | — | 7777 | Deceased in NADRA: hard flag |
| Shazia Bibi | `…0008` | `43201-1122334-8` | `03011234505` | 8888 | NADRA record in Urdu script |

Person ids are `10000000-0000-4000-8000-00000000000N`.

Tenants: relief `00000000-0000-4000-8000-000000000001`, fraud desk `00000000-0000-4000-8000-000000000002`.
Program debtor account: `PK00SAHA0000000000000001`, title `SAHARA RELIEF PROGRAM`. Monthly amount: **PKR 12,000**.

## rails-mock (port 4006) — simulated public rails

All `/mock/*` routes are `@InternalOnly()` unless marked. Simulated latency 50–300 ms.

| Route | Request | Response |
|---|---|---|
| `POST /mock/nadra/verify` | `{ cnic, fullName? }` | `{ match: boolean, nameScore: number \| null, record: { cnic, fullName, guardianName, dateOfBirth, gender, district, maritalStatus, deceased } \| null }` |
| `GET /mock/household/:cnic` | — | `{ cnic, householdSize, monthlyIncomePkr, district, pmtScore, ownsVehicle }` or 404 |
| `POST /mock/raast/title-fetch` | `{ iban? , alias? }` (one of) | `{ found: boolean, accountTitle: string \| null, bank: string \| null, ibanMasked: string \| null, iban: string \| null }` |
| `POST /mock/raast/transfer` | `{ endToEndId, amount, currency: "PKR", debtor: { name, iban }, creditor: { name, iban? , alias? }, remittanceInfo }` | `{ endToEndId, status: "ACSC" \| "RJCT", providerRef, reason? }` — **dedupes by `endToEndId`**: the same id always returns the first result and never debits twice |
| `GET /mock/raast/status/:endToEndId` | — | `{ endToEndId, status: "ACSC" \| "RJCT" \| "NOT_FOUND", providerRef \| null }` |
| `GET /mock/raast/statement?date=YYYY-MM-DD` | — | `{ date, entries: [{ endToEndId, amount, creditorIban, status, settledAt }] }` |
| `POST /mock/sms/send` | `{ to, body }` | `{ messageId }` |
| `GET /mock/sms/inbox/:phone` (role: admin — Judge Mode phone screen) | — | `[{ messageId, from, body, receivedAt }]` |
| `GET /mock/faults` / `POST /mock/faults` (role: admin) | `{ raast: { mode: "none" \| "fail" \| "timeout" \| "timeout_after_debit" \| "duplicate_statement", remaining: number, alias?: string } }` — with `alias`, only transfers to that Raast alias are affected | current fault config |

**Retries:** a business rejection (`AC02`/`AC03`) is final for that `endToEndId`; a new attempt needs a new id. Only after `NOT_FOUND` (never reached the provider) or an injected fault may the same id be resent.

`timeout_after_debit`: the transfer is recorded as settled, but the response is delayed 8 s (longer than the caller's timeout). This demonstrates `UNKNOWN → status inquiry → SUCCESS`, paid exactly once.

## cases (port 4002)

| Route | Who | Notes |
|---|---|---|
| `GET /internal/cases/:id/payout` | internal | `{ caseId, tenantId, personId, beneficiaryName, accountIban: string \| null, accountAlias: string \| null, amount }` — the account is the one **stored on the case at claim time**, so an approval stays bound to the account it was approved for |

### Evaluation and metrics (`/eval`, via the gateway)

| Route | Who | Notes |
|---|---|---|
| `POST /eval/run` | admin | Body `{ seed?: int, size?: 100–5000 }` (default seed 2026, 500 cases). Runs the decision engine on the **synthetic** labelled set at the tenant's current cost settings and stores the result (`eval_runs`). Returns `{ id, createdAt, headline, dataset, costs, metrics, rawBaseline, byArchetype, calibration, costCurve }` |
| `GET /eval/runs` | admin, auditor | Last 20 runs: `[{ id, createdAt, createdBy, datasetSeed, datasetSize, costs, headline }]` |
| `GET /eval/runs/:id` | admin, auditor | One full stored report |
| `GET /eval/summary` | admin, auditor, officer | Live numbers from real relief claims: `{ claims: { total, byStatus }, lanes: { decided, AUTO_APPROVE, HUMAN_REVIEW, ASK_MORE, automationRate }, queue: { size, inReview, needsInfo, waitingMinutes: { median, p90, max } }, timeToMoney: { paidCases, medianSeconds, p90Seconds, medianSecondsAutoApproved, medianSecondsOfficerApproved }, lastEval }` — time to money = case created → first `payment.success` timeline event |

Report fields: all numbers are on the **held-out 40%** split; calibration is fitted on the other 60%.

- `headline`: `accuracyOnDecided` (share of auto-approvals that were right — automation only approves), `routingAccuracy` (payable → auto-approved, not payable → human/question), `automationRate`, `wrongAutoApprovals` / `wrongAutoApprovalRate` (of auto-approved), `falseAlarms` (payable claims sent to a human or asked for more), `costPerCase` vs `costPerCaseAllHuman`, `calibratedEce` / `rawEce`.
- `metrics`: the engine as deployed (lanes, confusion matrix, false alarms by reason, wrong approvals with a 95% Wilson upper bound, fraud caught). `rawBaseline`: the same cases scored without calibration.
- `calibration`: Platt parameters fitted on this run vs the ones stored in the engine (`storedMatchesFit`), Brier / log loss / ECE before and after, and `reliability`: 10 equal-count bins of `{ from, to, n, predicted, observed }`.
- `costCurve.points[]`: per threshold 0.90–0.999 `{ threshold, automationRate, wrongAutoApprovals, observedCostPerCase, expectedCostPerCase, raw }`; `expectedMinimum` and `observedMinimum` give the threshold range with the lowest cost.

CI runs `pnpm --filter @haqdaar/cases eval:check` (golden-set gates: wrong auto-approvals ≤ 0.5%, routing accuracy ≥ 65%, automation of payable ≥ 45%, cost below all-human, ECE ≤ 0.06, stored calibration matches a refit).

**Events:** `cases.case.decided` is emitted **only when a case is finally approved** (automatically or by an officer), with `amount` > 0. Rejections and other moves emit `cases.case.status_changed`. Cases consumes `payments.payment.state_changed` (`SUCCESS` → case `PAID`) and `identity.consent.withdrawn`.

## payments (port 4004)

Consumes `cases.case.decided` → fetches `/internal/cases/:id/payout` → creates the payout with idempotency key `case:<caseId>` (one payout per case, ever). Emits `payments.payment.state_changed` on every transition.

## audit (port 4005)

Consumes **every** event type in `ALL_EVENT_TYPES`. Append-only, hash-chained. Read-only API for `auditor` and `admin`.

## identity (port 4001)

| Route | Who | Notes |
|---|---|---|
| `GET /consents/check?personId&purpose&grantedTo?` | internal | `{ allowed: boolean, consentId: string \| null }` |
| `POST /tenants` | platform admin | "Launch a program". `{ programName, type: "relief" \| "fraud_desk", adminName, adminPhone, adminPassword (≥ 8), monthlyRequestQuota? }` → 201 `{ tenant: { id, name, type, monthlyRequestQuota, createdAt }, admin: { id, name, role: "admin", phoneMasked } }`. Tenant, first admin and `identity.tenant.created` are written in one transaction (outbox). 409 if the phone already has an account |
| `GET /tenants` | platform admin | `[{ id, name, type, monthlyRequestQuota, createdAt, users }]` |
| `GET /tenants/me` | any user | `{ id, name, type, monthlyRequestQuota, createdAt, platformAdmin }` |
| `GET /tenants/:id/usage?days=7` (1–90) | that tenant's admin, or platform admin | `{ tenant, from, to, totals: { requests, errors, aiCalls }, quota: { monthlyRequestQuota, monthToDateRequests, percentUsed, exceeded }, daily: [{ day, requests, errors, aiCalls, services: { <service>: { requests, errors } } }] }`. Days are UTC, zero-filled. Anyone else: 403 (also for unknown ids) |
| `POST /internal/usage` | internal (gateway only) | `{ entries: [{ tenantId, day: "YYYY-MM-DD", service, requests, errors }] }` → adds to `usage_daily`; unknown tenants are dropped |

**Platform admin** = an `admin` user with `users.platform_admin = true`. Seeded on Admin Hira (`03001110004`) only; there is no API to set it. Identity checks the flag in its database on every tenants call (no token claim), so revoking it is immediate. `GET /auth/me` also returns `platformAdmin`.

**Onboarding:** cases consumes `identity.tenant.created` (idempotent) and gives the new tenant a **published rule v1** (copy of the Sahara template, emits `cases.rule.published`) and default cost settings, so the program can take claims at once.

**Usage metering:** the gateway counts every proxied response per (tenant, UTC day, service). The tenant comes from the bearer token's `tid` claim, decoded without verification — for metering only; services still verify every token. 401 responses are not counted (a forged `tid` cannot inflate another tenant's usage). `errors` = status ≥ 500. Counts are held in memory and flushed to `POST /internal/usage` every 15 s (`USAGE_FLUSH_MS`); a gateway crash loses at most that window. The quota is reported (percent used), not enforced.

**AI usage:** identity consumes `ai.call.completed` into `ai_usage_daily`. The ai service records the calling principal per request (`caller-context.ts`, an AsyncLocalStorage interceptor), so each vendor call carries the caller's `tenantId`. Calls made by services, and local mock answers, are not counted.

## ai (port 4003)

| Route | Who | Notes |
|---|---|---|
| `POST /ai/document-check` | citizen, helper, officer | CNIC photo checks. `multipart/form-data`: `file` (JPEG or PNG **by magic bytes**, max 5 MB → 413) and optional `cnic` the citizen typed (`12345-1234567-1`, dashes optional → 400 if malformed). Anything else → 400. |

Response (200):

```json
{
  "kind": "jpeg",
  "cnicFromOcr": "42201-1234567-4",
  "cnicFromQr": "42201-1234567-4",
  "fields": { "name": "Zainab Bibi", "fatherName": "Allah Ditta", "gender": "F", "dateOfBirth": "01.01.1980", "dateOfIssue": "15.03.2021", "dateOfExpiry": "15.03.2031" },
  "checks": [{ "id": "cnic_read", "ok": true, "detail": "Read 42201-1234567-4 from the card" }],
  "forgeryScore": 0.083,
  "blurScore": 0,
  "editedRegions": [{ "x": 0.032, "y": 0.61, "width": 0.24, "height": 0.051 }],
  "needsHuman": false,
  "retakeRequired": false,
  "explanationUr": "…",
  "explanationEn": "The card was read clearly and every check passed."
}
```

Check ids: `cnic_read`, `qr_read` (a missing QR is not a doubt), `ocr_matches_qr` (only when both read), `typed_matches_card` (typed vs printed number, QR if unreadable; only when something was read), `compression_consistent` (ELA), `no_editor_software` (EXIF/XMP), `sharp_enough` (blur), `card_not_expired` (only when the expiry date was read), `ai_available` (only under Kill AI).

- **Never rejects on heuristics.** Any failed check → `needsHuman: true` with the reason in `checks` and the explanations. `retakeRequired` when blurry (`blurScore ≥ 0.5`) or no CNIC could be read at all.
- `forgeryScore` 0..1 (≥ 0.5 means at least one edited-looking region); `editedRegions` are fractions of the **uploaded** image (before EXIF rotation). `blurScore` 0 = sharp, 1 = very blurry.
- The image is re-encoded with sharp (metadata and trailing bytes dropped) before OCR/QR/blur; ELA and EXIF read the original bytes. Nothing is sent to an external model. OCR is Tesseract (English) in a worker thread, model cached in `TESSDATA_DIR` (default: OS temp dir), loaded at boot; OCR unavailable or over `AI_TIMEOUT_MS` → `cnic_read` fails → human.
- Synthetic test cards: `node services/ai/dist/vision/fixtures.js [outDir]` (genuine, genuinePng, tampered, blurred, editedExif, mismatchedQr, expired).
