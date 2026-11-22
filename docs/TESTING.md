# Testing: properties and fuzzing

Example tests show that the system works for the cases someone thought of. This document covers the
other kind: **generated** tests, which state a rule that must hold for _every_ input and then try
thousands of inputs to break it.

- **Part A — property tests** (no network, deterministic): 46 properties × 2,500 generated cases
  each, plus exhaustive checks. They run with `node:test`, next to the code, in files named
  `*.property.test.ts`.
- **Part B — live fuzz harness** (`pnpm fuzz`): about 1,000 generated, mostly hostile requests
  through the gateway, with invariants checked on every answer.

Both print the seed they used. The same seed reproduces the same inputs.

## How to run

```bash
# Part A, without touching the running services (compiles into a throw-away folder, not dist/)
pnpm fuzz --unit

# Part A as part of the normal build + test of one service
pnpm --filter @haqdaar/cases build && pnpm --filter @haqdaar/cases test

# Replay one failing case (the failure message prints these values).
# PowerShell: $env:PROP_SEED = '20261154'; $env:PROP_RUNS = '1'; pnpm fuzz --unit
PROP_SEED=20261154 PROP_RUNS=1 pnpm fuzz --unit

# Part B: services must be running (pnpm start)
pnpm fuzz                                        # 500 requests, concurrency 6, random seed
pnpm fuzz --n=2000 --concurrency=8 --seed=42     # bigger, reproducible
pnpm fuzz --n=1000 --out=report.json --verbose   # full list of violations as JSON
```

Other flags of `pnpm fuzz`: `--rps=10` (global request rate), `--ai-cap=80` (AI-backed calls),
`--max-cases=30` (cases it may create), `--probe=identity-theft` (see finding 1).

`PROP_RUNS` changes how many cases each property generates (default 2,500), `PROP_SEED` the seed
(default 20261121).

## Part A — what each property proves

A line marked **(known gap)** is a property that does _not_ hold yet. It is kept in the suite as a
`todo` test: it runs, prints how many generated cases break it, and does not fail the build.

### Decision engine — `services/cases/src/engine/decide.property.test.ts`

| Property                               | What it proves                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| any input → safe outcome               | Nulls, missing fields, 50,000-character strings, Urdu/Arabic digits, emoji, RTL marks, absurd household sizes and junk settings never throw; the lane is always one of the three; confidence is in [0, 1]; both explanations are non-empty, contain no raw flag/enum ids and no CNIC or phone. |
| AUTO_APPROVE ⇔ every condition         | Auto-approval happens exactly when nothing is missing, both records are present, there is no hard flag, the rule is met (checked against the same rule written in plain TypeScript), confidence ≥ threshold and amount ≤ cap. An ineligible claim goes to a human: automation never rejects.   |
| any hard flag ⇒ never AUTO_APPROVE     | Every flag, repeated flags and unknown flag strings block auto-approval and are kept.                                                                                                                                                                                                          |
| monotonic safety                       | Adding a flag, removing a record or a consent, or weakening any piece of evidence never moves a claim toward auto-approval and never raises confidence.                                                                                                                                        |
| duplicate signals change nothing       | The same flag or missing item listed many times gives exactly the same outcome and text.                                                                                                                                                                                                       |
| costs: raising the wrong-approval cost | The threshold never falls and no new auto-approval appears.                                                                                                                                                                                                                                    |
| costs: nonsense costs                  | Zero, negative, NaN, or a review that costs more than a wrong approval never auto-approve.                                                                                                                                                                                                     |
| empty rule                             | A rule with no clauses never auto-approves.                                                                                                                                                                                                                                                    |
| queue priority                         | Always a finite, non-negative whole number; waiting longer or one more flag never lowers it.                                                                                                                                                                                                   |

### Rules as data — `services/cases/src/engine/rules.property.test.ts`

| Property                       | What it proves                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| hostile / malformed JSON Logic | Random trees with unknown operators, `eval`/`method`/`constructor`/`__proto__`, wrong arities and wrong types are refused by the schema or evaluate to "not met": no crash, no code execution, no prototype pollution. Whatever the schema accepts is safe on every fact set, not only on the empty dry run. |
| known payloads                 | Ten known code-execution and pollution payloads are refused or made inert.                                                                                                                                                                                                                                   |
| deep nesting                   | Up to 30,000 levels are refused without a stack overflow.                                                                                                                                                                                                                                                    |
| valid rules                    | A generated valid rule is accepted and gives the same answer as the same rule in TypeScript, clause by clause.                                                                                                                                                                                               |
| bad definitions                | Bad amounts, no clauses, too many clauses, bad ids and texts are refused.                                                                                                                                                                                                                                    |

### Name matching — `services/cases/src/engine/names.property.test.ts`, `services/rails-mock/src/names.property.test.ts`

| Property                      | What it proves                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| total and symmetric           | Any two strings give a score in [0, 1], the same in both directions.                                                                                                                                                                  |
| same person                   | Case, spacing, punctuation, Latin accents, Urdu vowel marks, Bibi/Begum/Khatoon/Mai/Mst., word order and twelve spellings of Muhammad all score 1.                                                                                    |
| different person (cases)      | A claim under another person's name is never auto-approved on a typed claim with default costs, however alike the names are (Majid/Sajid, Saima/Samina).                                                                              |
| different person (mock NADRA) | Two different people never reach the match threshold 0.85, even with the same title or first word.                                                                                                                                    |
| unknown names                 | Urdu names the transliteration table does not know, digits and emoji never match a different name; strings with no letters score 0.                                                                                                   |
| **(known gap)** voice claim   | With a perfect voice-extraction confidence of 1.0, look-alike names (Majid/Sajid 0.956) clear the engine's confidence gate. Not reachable through the API today because the cases service caps client-supplied extraction confidence. |

"Two Zainabs with different CNICs": two people with the _same_ name necessarily score 1, so the name
can never tell them apart. What keeps them apart is the CNIC key, and that is checked live in Part B
(a claim with another person's CNIC is refused with 403 under every spelling of the name).

### PII redaction — `services/ai/src/tasks/pii.property.test.ts`

| Property                | What it proves                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CNIC                    | Every CNIC written with dashes, without, with spaces, in Urdu or Arabic digits, inside Urdu / Roman Urdu / English sentences, is removed and recorded in canonical form. |
| mobile                  | Every 03xx, +923xx, 923xx, 00923xx number, any grouping, any digit script, is removed.                                                                                   |
| both, any order         | A CNIC and a phone in one message are both removed.                                                                                                                      |
| clean text              | Text without PII is unchanged (Urdu digits become 0–9, nothing else).                                                                                                    |
| hostile input           | 100,000-character and control-character input never throws and never invents PII.                                                                                        |
| grouped / glued numbers | `0300-123-4567`, `0300 123 4567` and numbers glued to letters (`cnic42201…`) are removed.                                                                                |

### Money path — `services/payments/src/domain/payments.property.test.ts`

The stateful service needs Postgres, so random event sequences run against a small in-memory model
built from the same pure functions the service uses.

| Property                      | What it proves                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| transition table (exhaustive) | Every state is reachable; REVERSED is terminal; nothing returns to CREATED; UNKNOWN is never re-sent blindly; after SUCCESS money can never be sent again; money only leaves from APPROVED or a confirmed FAILED.                    |
| random event sequences        | No illegal state; a refused transition changes nothing; one payment per idempotency key; at most one payout and one reversal per payment; ledger debits = credits after every step; the fund balance equals payouts minus reversals. |
| ledger                        | Only positive whole amounts are booked; unbalanced or one-sided groups are refused; payout + reversal cancel exactly.                                                                                                                |
| velocity                      | Own and old payouts never count; more payouts to other people never clear a hold.                                                                                                                                                    |
| reconciliation                | Every payout and every settled provider line is accounted for exactly once; double settlements are all flagged.                                                                                                                      |
| webhook signature             | Any single-character change of body or signature, a wrong secret or an old timestamp fails; junk headers never throw.                                                                                                                |
| receipt                       | The amount is always written in digits and words.                                                                                                                                                                                    |
| account title                 | The beneficiary's own title matches; an account in another person's name never does.                                                                                                                                                 |

### Haqdaar Seal — `packages/nest-kit/src/seal.property.test.ts`

| Property                               | What it proves                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| genuine always verifies                | Also re-spaced and re-cased, up to the last second of the expiry day; one second later it is `expired`. |
| single-character tamper of the message | Changing, deleting or inserting any one character breaks it.                                            |
| single-character tamper of the code    | Version, any expiry digit, any signature character.                                                     |
| moved or re-signed                     | A real code on another message, text added before or after the code, or another secret all fail.        |
| hostile text                           | Never throws; unsealed text is never reported valid.                                                    |

### Audit hash chain — `services/audit/src/chain.property.test.ts`

| Property                                                           | What it proves                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| untouched chain                                                    | Verifies; key reordering (jsonb) does not change a hash; any page verifies against the hash before it. |
| edit any field of any entry                                        | Detected at exactly that sequence number (`hash_mismatch`).                                            |
| edit and recompute the hash                                        | Detected at the next entry (`prev_hash_mismatch`).                                                     |
| stored hash / prevHash changed, entry deleted, swapped or inserted | Detected at the right sequence number.                                                                 |
| canonical JSON                                                     | Stable under key order; different values give different text.                                          |

### Numbers from the run (2026-11-22)

|                    |                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------- |
| Tests              | 57 (46 properties at 2,500 cases, 2 at 60 and 500, 9 exhaustive or example checks) |
| Generated cases    | 115,560                                                                            |
| Passed             | 56                                                                                 |
| Failed             | 0                                                                                  |
| Known gap (`todo`) | 1                                                                                  |

Whole test suites after the fixes (existing tests plus the property tests): ai 36/36, payments
24/24, cases 55 pass + 1 known gap, identity 15, rails-mock 20, audit 11, gateway 7, nest-kit 15,
shared 2.

On the first run, before any fix, the engine, rules, name-matching, PII and account-title
properties failed; those failures are findings 2–9 below. The audit chain and seal properties
passed unchanged.

## Part B — what the live harness checks

`scripts/fuzz.mjs` logs in each demo role once, signs up three synthetic citizens, and then fires
generated requests. The route list is read from the controllers' decorators at start, so a new
route is covered the moment it is written (88 routes when this was run).

| Invariant                                                    | How it is exercised                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No 5xx, ever                                                 | Checked on every response. A clean 503 from the gateway while a service restarts is waited out and counted separately.                                                                                                                                                                                                    |
| Every 4xx has `{ statusCode, error, message, requestId }`    | Checked on every response, plus the `x-request-id` header and no stack trace or SQL in the body.                                                                                                                                                                                                                          |
| Bad or hostile claims are never AUTO_APPROVE                 | Missing fields, wrong types, Urdu-digit CNICs, SQL / NoSQL / prompt-injection strings, mass-assignment keys (`status`, `lane`, `amount`, `personId`), hostile extraction notes. Invalid ones must be refused; valid ones create a case that must not be approved — checked on the answer and again at the end of the run. |
| 1 MB bodies → 413; wrong content types and broken JSON → 4xx | Sizes 1.2 MB and 6.5 MB, nine content types, thirteen broken JSON bodies, a NUL character, a 20 kB header.                                                                                                                                                                                                                |
| Same idempotency key 5× concurrently ⇒ one case              | Also: same key with a different body returns the first case; the key does not cross users.                                                                                                                                                                                                                                |
| A citizen never reads another citizen's data                 | Four outsiders × eleven attempts on one citizen's case, consents and staff views.                                                                                                                                                                                                                                         |
| Role checks hold for every route × role                      | Every route × 5 roles + anonymous: 407 requests. Denied pairs must get 401/403; internal routes must not exist from outside.                                                                                                                                                                                              |
| Forged tokens are refused                                    | `alg:none` (three ways), payload swapped to admin, HS256 signed with the public key, forged `exp`, truncated or reversed signature, wrong scheme, forged `x-internal-token`.                                                                                                                                              |
| Scam check on a labelled set                                 | 64 generated messages: 16 with a valid seal, 16 with a forged seal, 18 classic scams (Urdu, Roman Urdu, English), 14 harmless chats.                                                                                                                                                                                      |
| Rate limiting answers 429 with a clean body                  | 13 rapid logins for one synthetic phone.                                                                                                                                                                                                                                                                                  |

### Being a polite neighbour

The services and the database are shared, so the harness limits itself: at most 8 requests in
flight, a global rate of 10 requests per second, a wait (never a hard retry) on 429, one login per
role, never a wrong password for a real account, at most 30 cases and 80 AI-backed calls per run.
It refuses to run against anything but a local gateway.

Synthetic identities are recognisable: CNIC `99999-…`, phone `0399…`, names `Fuzz Qzvrtk Xwpdm`
(made-up words, so a leftover person can never look like a real citizen). The run prints how many
cases it created. `pnpm demo:reset` removes the cases; the synthetic accounts and person rows stay.

### Numbers from the run (2026-11-22, n = 1000, concurrency 8)

**To be re-run.** These numbers were taken before the last fixes were deployed, and the local
database (Docker) went down afterwards, so the harness has not been run against the final build.
Run `pnpm fuzz --n=1000 --concurrency=8` once the services are back and replace this table.

Two complete runs. The first had the machine to itself; during the second, other engineers were
rebuilding and restarting services.

|                                     | Run 1 (`--seed=20261122`) | Run 2 (`--seed=20261123`)   |
| ----------------------------------- | ------------------------- | --------------------------- |
| Requests sent                       | 1,039 in 114 s            | 1,032 in 131 s              |
| Latency p50 / p95 / p99             | 9 ms / 529 ms / 1,355 ms  | 14 ms / 1,001 ms / 4,657 ms |
| 2xx / 4xx / 5xx                     | 225 / 803 / 11            | 221 / 795 / 14              |
| Answers that were 429               | 3 (login throttle probe)  | 3                           |
| Route × role pairs checked          | 407, 0 wrong              | 407, 0 wrong (1 timed out)  |
| Forged tokens accepted              | 0 of 61                   | 0 of 61                     |
| IDOR attempts that succeeded        | 0 of 44                   | 0 of 44                     |
| Idempotency (5 concurrent, one key) | 1 case                    | 1 case                      |
| Fuzzed claims auto-approved         | 0                         | 0                           |
| Cases created                       | 24                        | 23                          |
| AI-backed calls                     | 35                        | 35                          |
| Distinct invariant violations       | 18                        | 21                          |

What the violations were, in run 2 (35 occurrences):

- 9 × HTTP 500 from `POST /ai/transcribe` and `POST /ai/document-check` (finding 11).
- 1 × HTTP 500 from `POST /cases` with a NUL character (finding 10).
- 10 × a 4xx without the standard error shape or without `x-request-id` (finding 13).
- 3 × HTTP 500 on read routes and 1 timeout while services were being restarted by others. The same
  requests answer 404 / 200 when repeated; they did not occur in run 1.

Run 1 also reported one "invalid claim accepted". That was a mistake in the harness (a missing
idempotency key was replaced by a default one) and is fixed.

Scam check, both runs identical:

| Kind          | n   | GENUINE | SCAM | UNSURE |
| ------------- | --- | ------- | ---- | ------ |
| Valid seal    | 16  | 16      | 0    | 0      |
| Forged seal   | 16  | 0       | 16   | 0      |
| Classic scam  | 18  | 0       | 18   | 0      |
| Harmless chat | 14  | 4       | 0    | 10     |

Precision 100% (34 of 34 SCAM verdicts were scams), recall 100% (34 of 34 scams caught), false
alarms 0% (no genuine or harmless message was called a scam), no scam passed as genuine.
Read these with two cautions:

- 10 of 14 harmless chats came back **UNSURE**, not GENUINE. The AI layer answered only 13 of 32
  times (free-tier quota and mock fallback); without it, a message with no seal and no red flag is
  "not sure → a human looks". Safe, but it means a human for most ordinary messages.
- The scam messages are generated from templates that use the classic phrases (fee, PIN, OTP,
  prize, link), which are the phrases the rule layer looks for. Recall on scams worded differently
  is not measured here and will be lower.

## Findings

Ranked by severity. "Fixed" means fixed in this work, in the files this work owns.

### Critical

**1. A new account can be auto-approved for a stranger's benefit — fixed.**
Fix: the first claim that ties a CNIC to a self-registered account gets the soft flag
`identity_first_claim` (`services/cases/src/cases/cases.service.ts`, `ai-notes.ts`), so it always
goes to an officer and is never auto-approved. The original report follows.
Sign up with any phone number, give your own consent, then claim with another person's CNIC and
name. The registry confirms the CNIC and name, the household is eligible, and the engine answers
`APPROVED / AUTO_APPROVE` (confidence 0.991). Nothing links the account to the CNIC.
Reproduce: `pnpm fuzz --probe=identity-theft` (it picks an eligible person of the mock registry
who is not part of the demo story). Observed: HTTP 201 `APPROVED / AUTO_APPROVE`, flags `[]`.
The payout was then HELD (`ACCOUNT_NOT_FOUND`) only because the payout alias was unknown to the
mock bank; the wrong approval itself had already happened.
Where: `services/cases/src/cases/cases.service.ts` (`resolvePerson`, line 154: the first claim binds
any CNIC to the caller's person).
Suggested fix: the first claim that binds a CNIC to an account must not be auto-approvable unless
the link is proven — a passed CNIC photo check for that CNIC, or the registry's registered mobile
matching the account's phone. Otherwise add a hard flag so a human looks.

### High — fixed

**2. A rule with an unknown operator behind `and` / `or` / `if` passed validation and crashed claims.**
Validation was a dry run on empty facts; short-circuit operators skip their other branches, so
`{"and":[{"var":"nadra.match"},{"bogus":[1]}]}` was accepted and then threw for every verified
claimant (HTTP 500 on `POST /cases`). Fixed in `engine/rules.ts`: the whole tree is checked against
a closed operator list, with a depth and size limit and plain fact paths only; a clause that still
throws counts as "not met" (a human looks) instead of crashing.

**3. Nonsense cost settings auto-approved everything.** With `wrongApproval: 0` the threshold is
−∞; with a review dearer than a wrong approval it is negative. The API refuses such settings, but
the engine trusted whatever was stored. Fixed in `engine/decide.ts`: costs that do not describe a
real trade-off never auto-approve.

**4. A rule with no clauses made everyone eligible** (`[].every()` is true). Fixed in
`engine/rules.ts`.

**5. The engine threw on malformed stored input** (`externalFlags` not a list, an unknown flag, a
null clause) — relevant because decisions are replayed from the database by the Digital Twin.
Fixed: `decide` is total; anything malformed is dropped and reported as `verification_unavailable`,
so a human looks.

**6. Names the transliteration table did not know all looked identical.** Non-Latin letters were
stripped, so `ثمینہ ناز` and `نادیہ اقبال` both became the empty string and scored 1.0 — a perfect
name match for two different women. `""` vs `""` also scored 1. Fixed in `engine/names.ts`: letters
of every script are kept, vowel marks and Latin accents are removed, and a name with no letters
scores 0.

**7. The mock NADRA matched different people who share a title.** `Zainab Bibi` vs `Shazia Bibi`
scored 0.905 (threshold 0.85); 1,452 of 3,900 pairs of different given names matched. Fixed in
`services/rails-mock/src/names.ts`: titles are dropped, every word of the shorter name must have a
counterpart, and a name with a word that has none is capped below the threshold.

**8. Mule check: an account in another person's name passed** when both names ended in the same
title (1,439 of 2,500 generated pairs). In `services/payments/src/domain/name-match.ts`, not owned
by this work; fixed there by its owner while this work was in progress. The property now passes.

**9. PII reached the external model** for `0300-123-4567`, `0300 123 4567` and numbers glued to
letters. In `services/ai/src/tasks/pii.ts`, not owned by this work; fixed there by its owner while
this work was in progress. The properties now pass.

### Medium — fixed

**10. `POST /cases` with a NUL character in `district` or `fullName` answered HTTP 500 — fixed.**
Both fields now refuse control characters and answer 400 (`cases.schemas.ts`, `plain`). Valid
JSON, passes validation, then PostgreSQL refuses the text. Reproduce: a valid claim with
`"district": "Thatta\u0000x"`. Expected 400. Where: `services/cases/src/cases/cases.schemas.ts`
lines 7 and 9. Suggested fix: refuse control characters in both fields.

**11. `POST /ai/transcribe` and `POST /ai/document-check` answered HTTP 500 when the body is not
multipart — fixed.** Both routes check `req.isMultipart()` first and answer 400. Reproduce: either route with `content-type: application/json` and body `{}`. Expected
400 or 415. Where: `services/ai/src/ai.controller.ts` lines 116 (`req.file()`) and 136
(`req.parts()`). Suggested fix: check `req.isMultipart()` first and answer 400.

**12. The scam checker sent the message text to the external model without redaction — fixed.**
It now sends `redactPii(normalized).text`. Before, `services/ai/src/tasks/scam-check.ts` sent
`normalized.slice(0, 1500)`; scam messages
routinely carry phone numbers, and a citizen may paste her CNIC. `extract-claim` redacts first.
Suggested fix: `redactPii(normalized).text`.

### Low — open

**13. Some gateway-level 4xx answers lack `requestId` or the `x-request-id` header:** a malformed
URL (`/cases/%E0%A4%A`, `FST_ERR_BAD_URL`), characters the proxy refuses (`/cases/%00`,
`/cases/..%2fqueue`), a header above 16 kB (431), and a CORS preflight without the right headers
(plain text). They are produced before the error filter runs.

**14. Look-alike names with a perfect voice claim** — the known gap listed in Part A.

**15. Each claim overwrites the stored name of the person.** `resolvePerson` updates `fullName`
from every new claim, so the name on record is whatever was typed last.

## Known limitations

- **The payment properties test a model, not the service.** The database code
  (`PaymentStateMachine`, optimistic locking, the unique idempotency key) is exercised only by
  `pnpm e2e` and `pnpm chaos`.
- **The audit chain cannot see truncation.** Deleting the newest entries, or editing the last entry
  and recomputing its hash, leaves a valid chain. Detecting that needs an anchor kept elsewhere.
- **Seal tampering is checked for visible changes.** Whitespace and letter case are ignored by
  design, and a look-alike Unicode character that lower-cases to the same letter (the Kelvin sign
  for `k`) also passes.
- **One slip in a long name is still a match.** `Shamim` / `Shamima`, `Tahir` / `Tahira` and
  `Irshad` / `Arshad` cannot be told from a typing mistake by spelling alone.
- **Generators are finite.** Name pools hold about 60 names; hostile strings about 25. A property
  that passes here is strong evidence, not a proof.
- **The route enumeration reads decorators with regular expressions.** A route declared in an
  unusual way (decorator split over lines, dynamic paths) would be missed silently.
- **Allowed role × route pairs are fired for GET only.** Allowed writes would change shared data.
- **An expired token is simulated** by editing `exp` under the original signature; a token that is
  genuinely past its 15 minutes was not waited for.
- **No fault injection.** Turning on rail failures would affect other engineers; `pnpm chaos`
  covers that.
- **Fuzz data stays behind.** Synthetic accounts and person rows are not deleted by
  `pnpm demo:reset`. The identity-theft probe binds one real mock-registry CNIC to a synthetic
  account each time it succeeds.
- **Latency is measured on a shared developer machine** at 10 requests per second. It says the
  system answers quickly when idle; it is not a capacity figure (`pnpm load` is closer to one).
