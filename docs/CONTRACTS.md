# Service contracts

The agreed interfaces between services. Change a contract only with a heads-up to everyone who uses it.
Events and their payload schemas live in `packages/shared/src/events.ts` (validated on publish).

## Synthetic reference data (shared by all seeds)

| Who | Person id | CNIC | Phone (Raast alias) | Account (IBAN) | Account title |
|---|---|---|---|---|---|
| Zainab Bibi (widow, Thatta, household 5, income 18,000) | `10000000-0000-4000-8000-000000000001` | `42201-1234567-4` | `03001110001` | `PK36SAHA0000001234567890` | `ZAINAB BIBI` |
| Rashida Begum (Karachi West, household 7, income 22,000) | `10000000-0000-4000-8000-000000000002` | `42201-7654321-2` | `03001110007` | `PK52SAHA0000007654321098` | `RASHIDA BEGUM` |
| Mule account (fraud demo) | — | — | `03009990000` | `PK11MULE0000009999999999` | `MUHAMMAD ASLAM` |

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
| `GET /mock/faults` / `POST /mock/faults` (role: admin) | `{ raast: { mode: "none" \| "fail" \| "timeout" \| "timeout_after_debit" \| "duplicate_statement", remaining: number } }` | current fault config |

**Retries:** a business rejection (`AC02`/`AC03`) is final for that `endToEndId`; a new attempt needs a new id. Only after `NOT_FOUND` (never reached the provider) or an injected fault may the same id be resent.

`timeout_after_debit`: the transfer is recorded as settled, but the response is delayed 8 s (longer than the caller's timeout). This demonstrates `UNKNOWN → status inquiry → SUCCESS`, paid exactly once.

## cases (port 4002)

| Route | Who | Notes |
|---|---|---|
| `GET /internal/cases/:id/payout` | internal | `{ caseId, tenantId, personId, beneficiaryName, accountIban: string \| null, accountAlias: string \| null, amount }` — the account is the one **stored on the case at claim time**, so an approval stays bound to the account it was approved for |

**Events:** `cases.case.decided` is emitted **only when a case is finally approved** (automatically or by an officer), with `amount` > 0. Rejections and other moves emit `cases.case.status_changed`. Cases consumes `payments.payment.state_changed` (`SUCCESS` → case `PAID`) and `identity.consent.withdrawn`.

## payments (port 4004)

Consumes `cases.case.decided` → fetches `/internal/cases/:id/payout` → creates the payout with idempotency key `case:<caseId>` (one payout per case, ever). Emits `payments.payment.state_changed` on every transition.

## audit (port 4005)

Consumes **every** event type in `ALL_EVENT_TYPES`. Append-only, hash-chained. Read-only API for `auditor` and `admin`.

## identity (port 4001)

| Route | Who | Notes |
|---|---|---|
| `GET /consents/check?personId&purpose&grantedTo?` | internal | `{ allowed: boolean, consentId: string \| null }` |
