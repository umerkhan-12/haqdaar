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

**Events:** `cases.case.decided` is emitted **only when a case is finally approved** (automatically or by an officer), with `amount` > 0. Rejections and other moves emit `cases.case.status_changed`. Cases consumes `payments.payment.state_changed` (`SUCCESS` → case `PAID`) and `identity.consent.withdrawn`.

## payments (port 4004)

Consumes `cases.case.decided` → fetches `/internal/cases/:id/payout` → creates the payout with idempotency key `case:<caseId>` (one payout per case, ever). Emits `payments.payment.state_changed` on every transition.

## audit (port 4005)

Consumes **every** event type in `ALL_EVENT_TYPES`. Append-only, hash-chained. Read-only API for `auditor` and `admin`.

## identity (port 4001)

| Route | Who | Notes |
|---|---|---|
| `GET /consents/check?personId&purpose&grantedTo?` | internal | `{ allowed: boolean, consentId: string \| null }` |

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
