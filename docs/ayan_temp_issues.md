# Ayan's assigned issues and implementation plan

Status: issue #5 implementation is ready for user review on branch `ayan`. Issues #6–#8 have not started. Build, integration checks and the golden evaluation remain unverified because pnpm is unavailable in this workspace; nothing has been committed or pushed.

Repository: `umerkhan-12/haqdaar`
Working branch: `ayan`
Source: the original GitHub issue export preserved at the end of this file, plus `docs/TEAM_AI_TASKS.md`, `docs/ARCHITECTURE.md` and `docs/CONTRACTS.md`.

## 1. Review and push workflow

The user reviews each issue before its work is pushed. Follow this sequence for every issue:

1. Implement only the current issue, including its contracts, documentation and meaningful tests.
2. Run the issue-specific checks and the required integration checks. Report any check that could not run and the reason; do not describe blocked checks as passing.
3. Present a review handoff: changed files, resulting behaviour, acceptance-criteria checklist, test results, limitations and a short demo procedure.
4. **Stop and wait for the user's review. Do not start the next issue or push while review is pending.**
5. Address requested changes and repeat the relevant checks. Stop for review again if the changes need another review.
6. After the user approves the issue for push, create the issue's commit and push `ayan`. Report the commit and push result. Do not merge into `main`.
7. Wait for the user's go-ahead before starting the next issue.

For the current issue, do not commit or push until the user reviews and approves it. Then push the issue commit to `ayan`; wait for the user's go-ahead before starting the next issue.

The issue descriptions suggest `ayan/rag`, `ayan/eval-ai`, `ayan/fraud-ring` and `ayan/helper-memory`. The user's current instruction takes precedence: work on `ayan` with separate commits per issue. A branch named `ayan` cannot coexist locally with branches named `ayan/...`; revisit branch naming only if the user requests that PR layout.

## 2. Scope and order

| Order | GitHub issue | Deliverable | Start condition |
|---|---|---|---|
| 1 | [#5 B1](https://github.com/umerkhan-12/haqdaar/issues/5) | Policy-only question answering with citations | Implementation ready for review |
| 2 | [#6 B2](https://github.com/umerkhan-12/haqdaar/issues/6) | AI golden sets, evaluator and provider comparison | #5 reviewed; user authorizes next issue |
| 3 | [#7 B3](https://github.com/umerkhan-12/haqdaar/issues/7) | Fraud signals, officer evidence and Judge Mode c09 | #6 reviewed; user authorizes next issue |
| 4 | [#8 B4, stretch](https://github.com/umerkhan-12/haqdaar/issues/8) | Family-specific helper memory | **#5–#7 merged**, then user authorizes implementation |

The issue deadline is Sunday 22 November 2026 at 12:00 PKT. B4 is optional and must not displace B1–B3.

TTS, claim conversation, spoken explanations and voice recordings are Ali's assignments. Reuse their contracts when needed; do not rebuild those features inside Ayan's work.

## 3. Shared implementation rules

- Keep the existing TypeScript, NestJS/Fastify, Zod, Prisma and `node:test` stack.
- All model operations must use the shared AI routing system. Extend it for embeddings rather than creating a separate vendor client in knowledge task code.
- Redact citizen text before embedding or prompting. Treat questions and retrieved policy text as untrusted data.
- Keep deterministic offline behaviour and respect Kill AI. Do not let cached live-model output bypass a kill or profile change.
- Never approve eligibility, reject claims or initiate payments from generated text.
- Keep tenant checks on stored data, role checks on routes, bounded Zod inputs and service-to-service authentication.
- Use synthetic records only. Do not commit `.env`, API keys, generated credentials or local caches.
- Update `docs/CONTRACTS.md` in the same issue change whenever a route or event changes.
- Preserve the decision engine's existing calibration and evaluation. B2 evaluates model tasks; it is separate from decision-engine evaluation.
- Add new services to all applicable local and deployment wiring, including service registry, gateway, startup, environment examples, schema initialization and Render configuration.

## 4. Issue #5 — B1: policy RAG

### 4.1 Service and data foundation

- [x] Create `services/knowledge` using the existing service layout: package scripts, Nest configuration, bootstrap, module, environment validation, health check and Prisma service.
- [x] Register port `4008`, `KNOWLEDGE_URL` and `/knowledge` in `packages/shared/src/services.ts`.
- [x] Add the service to the launcher, infrastructure schema initialization and deployment configuration. Ensure setup works both for a fresh database and an existing database volume.
- [x] Define knowledge-owned document/chunk records. Store stable document and chunk IDs, heading, text, content hash, embedding vector and embedding model/version.
- [x] Keep vectors from different embedding models, dimensions or offline/live modes separate. Reject or rebuild an incompatible index instead of comparing incompatible vectors.

### 4.2 Policy corpus

- [x] Write seven short bilingual synthetic policies under `docs/policy/`: eligibility, required documents, payment schedule, complaints, scams, privacy/consent and helper rules.
- [x] Align claims about amounts, districts and consent with the existing demo contracts and seeded rules. Explain any illustrative schedule explicitly.
- [x] Give headings stable identifiers and record corpus/version information for reproducible evaluation.

### 4.3 Ingestion and embeddings

- [x] Add `pnpm knowledge:ingest`.
- [x] Split by headings, targeting about 400 tokens and 50-token overlap. Document the token-count approximation if used; retain heading/source identity across overlapping chunks.
- [x] Hash normalized chunk content. Reuse unchanged embeddings, update changed chunks and remove stale chunks when documents change or disappear.
- [x] Add embedding requests/results to the AI provider/router interfaces, with timeout, circuit breaker, profile selection, audit context and offline support.
- [x] Use the issue's requested Gemini `text-embedding-004` if available. Verify availability during implementation; surface any required substitution for review rather than silently changing it.
- [x] Implement deterministic hashed bag-of-words embeddings for offline use. Handle Urdu/English normalization and document the limits of cross-language offline retrieval.
- [x] Make ingestion restartable and avoid leaving an incomplete index active after a failed run.

### 4.4 Retrieval and grounded answers

- [x] Add `POST /knowledge/ask` with `{ question }` and the required `{ answer, citations: [{ docId, heading, quote }], refused }` response.
- [x] Apply citizen/helper/officer role checks, input limits and PII redaction before retrieval/model calls.
- [x] Embed the question with the same model/version as the selected index; calculate cosine similarity in Node and retrieve the top four chunks.
- [ ] Tune the documented relevance thresholds using the RAG golden set. Below threshold, return a fixed bilingual refusal with no invented citation.
- [x] Add `POST /ai/answer-from-sources` at the end of the shared controller, using task `rag_answer@v1` and `structured(...)`.
- [x] Give the model bounded source chunks and require sentence-level source IDs internally. Validate that each referenced ID was retrieved and each returned quote occurs in that source.
- [x] Refuse missing, invalid or unsupported citations. Source ID validation alone does not prove the sentence is supported; add grounding checks and adversarial examples.
- [x] Provide a deterministic, source-extractive offline response for relevant questions; fail safely when a grounded answer cannot be produced.
- [x] Keep policy instructions from changing system behaviour. Do not give the answer task tools or permission to make claim decisions.

### 4.5 Acceptance and review

- [ ] Relevant question returns the expected policy citation and an accurate quote.
- [ ] Out-of-scope question such as “cricket score?” is refused.
- [ ] An instruction planted in a policy chunk is ignored.
- [ ] Missing index, embedding failure, model failure, Kill AI and invalid citations produce a safe response.
- [ ] Unchanged ingestion makes no additional embedding calls; changed/deleted content updates correctly.
- [x] Add a 15-question golden set and evaluator for citation-document correctness and refusal metrics. Actual metrics await a run.
- [x] Document setup, ingestion, routes and a short manual demo. Shared build/integration checks remain pending; implementation is now stopped for user review.

## 5. Issue #6 — B2: AI evaluation and prompt tuning

### 5.1 Labelled datasets

- [ ] Add `services/ai/eval/golden/claims.jsonl` with exactly 50 uniquely identified synthetic transcripts and explicit expected fields/intent.
- [ ] Include Urdu script, Roman Urdu, English, missing fields, two different CNICs, repeated names and prompt injection.
- [ ] Add `scams.jsonl` with exactly 40 labelled SMS covering genuine seals, forged seals, classic scams and ordinary messages.
- [ ] Generate seal fixtures reproducibly with a test-only secret and controlled dates so expiry does not make the set silently change over time.
- [ ] Validate dataset shape, unique IDs, label ranges and synthetic identifiers before making model calls. Keep evaluation inputs out of prompts as labels.

### 5.2 Evaluator and reporting

- [ ] Add root `pnpm eval:ai`, using the existing extraction/scam functions and router rather than duplicating task logic.
- [ ] Report per-field and aggregate extraction accuracy, missing/ambiguous field handling, scam precision/recall/false-alarm rate, abstentions and p50/p95 latency.
- [ ] Record actual provider/model, profile, task version, cache hits, fallback use, dataset hash and timestamp.
- [ ] Preserve token usage needed for cost estimation. Record the pricing basis/date and distinguish estimates from billed charges; do not treat missing usage as zero cost.
- [ ] Separate cold provider runs from cached runs and prevent profile changes from reusing incompatible cached outputs.
- [ ] Offline CI validates dataset format and safe regression behaviour. Offline mock performance must not be presented as real Groq/Gemini accuracy.
- [ ] Add the offline command to CI without replacing the existing decision-engine golden-set check.

### 5.3 Provider comparison and storage dependency

- [ ] Capture a baseline before prompt changes, then evaluate revised prompts on the same dataset. Bump task versions and record both results.
- [ ] Run `dev` and `demo` with authorized credentials. Record fallbacks so results are attributed to the provider that actually answered, rather than assuming profile equals provider.
- [ ] Write `docs/EVAL_AI.md` with dataset coverage, commands, metric definitions, before/after results and the Groq/Gemini comparison.
- [ ] Coordinate shared ownership of `docs/EVAL_AI.md` with Ali, whose voice results also belong there.
- [ ] Confirm an AI-summary upload contract with Umer. Current `/eval/run` creates decision reports and does not accept uploaded AI summaries. Do not misuse that route or write directly to another service's schema.
- [ ] Once agreed, publish a validated tenant-scoped report to the cases evaluation API and expose it alongside decision quality without overwriting existing reports.

### 5.4 Acceptance and review

- [ ] Both required datasets are committed and format checks pass.
- [ ] `pnpm eval:ai` works offline and supports live dev/demo runs.
- [ ] Reports identify unavailable or unmeasured values honestly. Real comparison remains incomplete if network or credentials block it.
- [ ] The agreed report-upload integration works, or is explicitly listed as blocked pending Umer's contract.
- [ ] Run the shared checks and present the results for review before any push.

## 6. Issue #7 — B3: fraud ring signals

### 6.1 Evidence collection and signal rules

- [ ] Add a pure `services/cases/src/engine/anomaly.ts` with typed inputs/results, configurable thresholds and an injected evaluation time.
- [ ] Collect evidence through tenant-scoped SQL aggregates over cases-owned data. Use CNIC hashes/person identities for counts, never plaintext CNICs in evidence output.
- [ ] Normalize payout aliases/accounts. Resolve account/alias equivalence only through existing service contracts, not direct reads of payments-owned tables.
- [ ] Signal 1: one receiving account/alias associated with more than two distinct CNICs.
- [ ] Signal 2: one helper submitting more than configurable N claims within an hour; distinguish helper submissions from citizens.
- [ ] Signal 3: repeated household-number patterns in the same district within a configured short window; define the exact household fields and minimum count before coding.
- [ ] Signal 4: same normalized name and district under different CNICs, with corroborating details. Different supporting details must protect the two-Zainabs case from a false positive.
- [ ] Define which statuses/time ranges count and exclude duplicate deliveries/retries from inflating evidence. Record the selected rules in contracts/documentation.
- [ ] Check where household fields are currently stored and add a cases-owned snapshot/index if necessary; avoid relying on an input field that creation currently discards.

### 6.2 Decision and officer integration

- [ ] Extend hard-flag types and explanations for `anomaly:<type>` values.
- [ ] Store signal type, evidence case IDs, time window and observed count/threshold. Expose permitted evidence to the officer queue/detail view.
- [ ] Run relevant checks before automatic approval, ensuring three concurrent claims cannot all miss the new pattern because each read occurs before the others commit.
- [ ] Add an authenticated on-demand scan/job with idempotent findings and bounded query batches. Repeated scans must not duplicate timeline entries or flags.
- [ ] Flag open cases for human review. Do not silently reverse settled payments or rewrite past decisions when a later scan finds a pattern.

### 6.3 Judge scenario and acceptance

- [ ] Add and register `c09-fraud-ring`: three distinct synthetic beneficiaries submit to one alias, then the scenario verifies anomaly flags and evidence.
- [ ] Make the scenario deterministic offline and repeatable after demo reset. It must prove the anomaly feature rather than only the existing payment velocity hold.
- [ ] Add a unit test per signal and boundary values; include the two-Zainabs false-positive case, tenant separation and clean-case regression.
- [ ] Verify scan retries, duplicate submits and concurrent evidence collection do not corrupt counts or produce automatic rejections.
- [ ] Update contracts and run the shared checks, then stop for review.

## 7. Issue #8 — B4: helper memory, stretch

Do not begin until issues #5–#7 are merged. A push or approval alone does not satisfy that prerequisite.

- [ ] Agree a bounded, versioned memory format with Ali's claim-conversation response: claim state, last questions, progress identifiers and update time.
- [ ] Add memory storage under identity's existing helper/family link. Define any expiry and sensitive-field handling explicitly.
- [ ] Add authenticated read/update routes. Derive helper identity and active family from the token; enforce both the helper link and matching `onBehalfOf` family.
- [ ] Require the selected family's PIN-issued session; knowing a family ID must not authorize memory access.
- [ ] Prevent stale requests from overwriting newer state, using a revision or conditional update.
- [ ] Integrate persistence/resume with the agreed conversation contract and document how incomplete drafts are restored.
- [ ] Test switching families and back, attempts to read/write another family's memory, ordinary helper tokens without a selected family and stale updates.
- [ ] Update contracts, run the shared checks and stop for user review.

## 8. Validation and completion checklist

Run the issue-specific tests during implementation. Before each review/push handoff, run the team-required commands against a prepared, synthetic demo environment:

```powershell
pnpm build
pnpm test
pnpm e2e
node scripts/judge-all.mjs 1 --reset
```

Add `pnpm knowledge:ingest` and the RAG evaluation for B1; add `pnpm eval:ai` offline plus authorized live runs for B2. Build/schema generation and database preparation must precede commands that depend on them. Demo reset commands clear demo activity, so use the intended local demo stack.

For every issue handoff, include:

- [ ] Issue number and acceptance checklist with evidence.
- [ ] Files changed and public/internal API changes.
- [ ] Exact validation results and any unrun checks.
- [ ] Known limitations, integration dependencies and remaining work.
- [ ] A short reproduction/demo procedure.
- [ ] User review completed and changes addressed.
- [ ] Explicit approval for commit/push received.
- [ ] Commit/push result reported, then wait for next-issue authorization.

## 9. Original GitHub issue export

The following export is retained verbatim as supplied, so the plan can be compared with the explicit issue requirements.

```text
,title,body,url
[
  {
    "body": "**Only after B1–B3 are merged.**\n\nHelper Mode remembers each family's last claim state and last questions, so a helper switching between families resumes where they stopped. Stored in identity under the existing act-for family link; readable only inside that family's PIN session.\n\n**Done when**\n- [ ] switching families and back restores the state\n- [ ] another family's session cannot read it (test)\n\n**Branch:** `ayan/helper-memory`\n\n---\n**Before the PR:** `pnpm build && pnpm test`, `pnpm e2e`, `node scripts/judge-all.mjs 1 --reset` all green. Works with `AI_PROFILE=offline` (deterministic mock). Model calls only through `AiRouter` / `structured(...)`, citizen text through `redactPii` first. Synthetic data only, never commit `.env`. Update `docs/CONTRACTS.md` if you add a route or event.\n\n**Deadline:** merged by Sun 22 Nov, 12:00 PKT. Full brief and rules: https://github.com/umerkhan-12/haqdaar/blob/main/docs/TEAM_AI_TASKS.md",
    "number": 8,
    "title": "B4 (stretch): Helper memory — resume each family where you left off",
    "url": "https://github.com/umerkhan-12/haqdaar/issues/8"
  },
  {
    "body": "Pure function in `services/cases/src/engine/anomaly.ts` + on-demand job. **Only raises flags that send a case to a human; never rejects.**\n\nSignals:\n- one payout account/alias used by > 2 different CNICs\n- one helper submitting > N claims per hour\n- many claims with identical household numbers from one district in a short window\n- same name + district with different CNICs — but the \"two Zainabs\" case must **not** be flagged when other details differ\n\nSQL aggregates over `cases.cases`; each hit → hard flag `anomaly:<type>` with evidence ids, shown in the officer queue. Add Judge Mode scenario `c09-fraud-ring` in `services/judge/src/scenarios/` (3 claims to one alias → flag).\n\n**Done when**\n- [ ] unit test per signal + the two-Zainabs false-positive test\n- [ ] judge scenario passes\n- [ ] clean cases still auto-approve as before\n\n**Branch:** `ayan/fraud-ring`\n\n---\n**Before the PR:** `pnpm build && pnpm test`, `pnpm e2e`, `node scripts/judge-all.mjs 1 --reset` all green. Works with `AI_PROFILE=offline` (deterministic mock). Model calls only through `AiRouter` / `structured(...)`, citizen text through `redactPii` first. Synthetic data only, never commit `.env`. Update `docs/CONTRACTS.md` if you add a route or event.\n\n**Deadline:** merged by Sun 22 Nov, 12:00 PKT. Full brief and rules: https://github.com/umerkhan-12/haqdaar/blob/main/docs/TEAM_AI_TASKS.md",
    "number": 7,
    "title": "B3: Fraud ring signals (anomaly detection) + Judge Mode scenario c09",
    "url": "https://github.com/umerkhan-12/haqdaar/issues/7"
  },
  {
    "body": "- `services/ai/eval/golden/claims.jsonl`: 50 labelled synthetic transcripts (name, CNIC, district, household size, intent; tricky ones: two CNICs, repeated name, injection, English only, Roman Urdu).\n- `scams.jsonl`: 40 labelled SMS (real seal, fake seal, classic scam, normal message).\n- `pnpm eval:ai`: runs extract-claim and scam-check with the active profile → field accuracy, scam precision/recall/false-alarm rate, p50/p95 latency, cost per provider.\n- Write `docs/EVAL_AI.md`; post the summary to the cases eval store (ask Umer for the route). In CI (offline) it is a format/regression check; run with `dev` and `demo` for the real comparison.\n- Tune the prompts in `extract-claim.ts` and `scam-check.ts`, bump task versions, record before/after.\n\n**Done when**\n- [ ] both golden sets committed\n- [ ] script runs in CI (offline) and with dev/demo\n- [ ] Groq vs Gemini table in `docs/EVAL_AI.md`\n\n**Branch:** `ayan/eval-ai`\n\n---\n**Before the PR:** `pnpm build && pnpm test`, `pnpm e2e`, `node scripts/judge-all.mjs 1 --reset` all green. Works with `AI_PROFILE=offline` (deterministic mock). Model calls only through `AiRouter` / `structured(...)`, citizen text through `redactPii` first. Synthetic data only, never commit `.env`. Update `docs/CONTRACTS.md` if you add a route or event.\n\n**Deadline:** merged by Sun 22 Nov, 12:00 PKT. Full brief and rules: https://github.com/umerkhan-12/haqdaar/blob/main/docs/TEAM_AI_TASKS.md",
    "number": 6,
    "title": "B2: AI golden set + pnpm eval:ai (Groq vs Gemini numbers for judges)",
    "url": "https://github.com/umerkhan-12/haqdaar/issues/6"
  },
  {
    "body": "- New `services/knowledge` (port 4008), copying the structure of `services/audit`: `KitModule.forRoot`, `env.ts`, Prisma schema `knowledge`. Register in `packages/shared/src/services.ts` and as gateway route `/knowledge`.\n- Corpus: 6–8 short synthetic policy docs in `docs/policy/*.md` (eligibility, documents, payment schedule, complaints, scams, privacy/consent, helper rules), Urdu + English.\n- `pnpm knowledge:ingest`: split by heading (~400 tokens, 50 overlap), Gemini `text-embedding-004`, store `Float[]` + `docId`, `heading`, `contentHash`; only changed chunks re-embed. Offline profile: deterministic hashed bag-of-words embedding.\n- Cosine in Node (≈200 chunks, < 1 ms); pgvector optional later.\n- `POST /knowledge/ask { question }` → `{ answer, citations: [{ docId, heading, quote }], refused }`. Redact → embed → top 4 → below threshold = refuse. Otherwise one call to a new `POST /ai/answer-from-sources` (task `rag_answer@v1`). Every sentence must cite a retrieved chunk, else refuse. Chunks are DATA, never instructions.\n\n**Done when**\n- [ ] in-scope question → right citation\n- [ ] out-of-scope (\"cricket score?\") → refused\n- [ ] injection planted in a policy chunk → ignored\n- [ ] 15-question golden set with refusal accuracy reported\n\n**Branch:** `ayan/rag`\n\n---\n**Before the PR:** `pnpm build && pnpm test`, `pnpm e2e`, `node scripts/judge-all.mjs 1 --reset` all green. Works with `AI_PROFILE=offline` (deterministic mock). Model calls only through `AiRouter` / `structured(...)`, citizen text through `redactPii` first. Synthetic data only, never commit `.env`. Update `docs/CONTRACTS.md` if you add a route or event.\n\n**Deadline:** merged by Sun 22 Nov, 12:00 PKT. Full brief and rules: https://github.com/umerkhan-12/haqdaar/blob/main/docs/TEAM_AI_TASKS.md",
    "number": 5,
    "title": "B1: \"Ask about the program\" (RAG) — new knowledge service, answers only from policy docs",
    "url": "https://github.com/umerkhan-12/haqdaar/issues/5"
  }
]
```
