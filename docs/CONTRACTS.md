# Service contracts

The agreed interfaces between services. Change a contract only with a heads-up to everyone who uses it.
Events and their payload schemas live in `packages/shared/src/events.ts` (validated on publish).

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
