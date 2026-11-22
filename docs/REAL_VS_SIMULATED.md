# Real vs simulated

> **PROTOTYPE ONLY — not an official government service.** No real personal data is used anywhere. Every person, CNIC, phone number, bank account and policy document in this repository is synthetic.

The brief asks teams to tell the judges what is real and what is simulated. This page is that answer, plus the limits we know about.

## 1. One table

| Part | Real, simulated or limited | What that means here |
| ---- | -------------------------- | -------------------- |
| Urdu speech to text | **Real** | Groq Whisper `whisper-large-v3` transcribes the recording. Gemini is wired as an alternative and capped at USD 2 of total spend; it has no credit today, so the router skips it and Whisper answers. |
| LLM calls (claim extraction, scam classification, explanation wording) | **Real** | Groq `openai/gpt-oss-120b` through one router with a timeout, a circuit breaker per provider and a fallback chain. Every answer is validated against a Zod schema. |
| Urdu text to speech | **Real** | 194 sentences recorded ahead of time and shipped with the app. Other sentences (her name, her amount) come from `POST /ai/speak`: Microsoft's `ur-PK-UzmaNeural` voice through `msedge-tts`, cached on disk. If that fails, the phone's own voice speaks. |
| OCR of the CNIC photo | **Real** | Tesseract (English model) runs inside our AI service. |
| QR decoding | **Real** | `jsqr`, on our server. |
| Forgery, editing-software, blur and expiry checks | **Real, heuristic** | Error-level analysis for edited regions, EXIF/XMP software tags, a blur score, the printed expiry date. They never reject; a failed check sends the case to an officer. |
| Login and permissions | **Real** | RS256 JWT signed by the identity service only; refresh rotation with reuse detection; argon2id for passwords and PINs; every service checks role and tenant itself. |
| Database | **Real** | PostgreSQL, one schema per service. |
| Audit log | **Real** | Append-only, each entry hashed with the one before it (SHA-256 chain). "Verify chain" recomputes it. |
| Haqdaar Seal | **Real** | An HMAC code on every genuine program message. Changing one character breaks it. |
| PII protection | **Real** | CNIC and phone are AES-256-GCM encrypted at rest with an HMAC hash for lookup, masked on staff screens, and removed from text before any prompt. |
| Rule engine, versions, Digital Twin, cost threshold, calibration | **Real** | JSON Logic rules stored as data; decisions store their inputs and rule version and can be replayed. |
| Payment state machine, idempotency, maker-checker, double-entry ledger, reconciliation, signed webhooks | **Real logic** | The logic is real and tested. The rail it talks to is simulated (next rows). |
| Offline outbox and service worker | **Real** | IndexedDB on the phone, one idempotency key per claim. |
| NADRA identity check | **Simulated** | `services/rails-mock`: a registry of made-up people with fuzzy name matching. |
| Raast (title fetch, transfer, status, statement) | **Simulated** | `services/rails-mock`, with field names modelled on ISO 20022 and a fault switch (fail, timeout, timeout after debit, duplicate statement line). No money exists. |
| Household and income registry | **Simulated** | `services/rails-mock`. |
| SMS | **Simulated** | Messages are stored and shown on the "Mock phone" page. The sign-up screen shows the one-time code on screen, labelled "SIMULATED SMS (prototype only)". |
| Bank accounts, IBANs, the program fund | **Simulated** | Invented numbers. |
| All people, CNICs, phone numbers | **Simulated** | Listed in `docs/CONTRACTS.md`. Demo CNIC cards are generated specimens stamped "NOT A REAL CNIC" (`docs/demo/specimen-cnic.md`). |
| The "Sahara" relief program and its policy documents | **Simulated** | Fictional program; the policy texts in `docs/policy/` were written by us. |
| Evaluation numbers | **Real computation, synthetic data** | The dashboard runs the real engine on a generated labelled set (default 500 cases, seed 2026; numbers reported on the held-out 40%). They say how the engine behaves on data we built, not how it would do on real citizens. |
| The helpline number `1234` in the receipt text | **Simulated** | Not a real helpline. |

## 2. AI models and tools, and why each was chosen

| Job | Choice | Why |
| --- | ------ | --- |
| Speech to text | Groq Whisper large-v3 | Handles Urdu and Roman-Urdu code-switching; fast enough for a turn-by-turn conversation; free tier covered the build. |
| Text tasks (extract, classify, rephrase) | Groq `openai/gpt-oss-120b`; Gemini `gemini-3.5-flash-lite` as the alternative | Free tier, low latency, good JSON output. Two vendors behind one interface, so one outage does not stop the demo. The paid Gemini key has a hard USD 2 cap that survives restarts. |
| Text to speech | 194 recordings + Microsoft `ur-PK-UzmaNeural` (via `msedge-tts`) + phone voice | A Pakistani Urdu neural voice at no cost. Recordings need no network at all. The live voice is an unofficial free endpoint, so it sits behind a circuit breaker and has a fallback. |
| CNIC reading | Tesseract, `jsqr`, `sharp`, `exifr`, all on our server | **Privacy: a photo of an identity card never leaves our server and is never sent to an outside model.** The AI service has no database; the image is processed in memory and the claim carries only the check result. Also free and predictable. |
| Scam detection | Seal check, then fixed red-flag rules, then the LLM only for what is left | The seal gives certainty for program messages. Rules are explainable and work with the AI off. The LLM is used where the cheap layers cannot decide, and disagreement means "not sure". |
| Decision | Rule engine + calibrated score. **No LLM.** | An LLM answer cannot be replayed or audited. Rules can: every decision stores its inputs, rule version, confidence and threshold. |
| Confidence | Hand-set evidence weights, then Platt scaling fitted on the labelled set | A raw score is not a probability. A unit test refits the calibration and fails if the stored parameters drift. |
| Structured output | Zod schema + one repair attempt + versioned task names | A malformed answer becomes "not sure", never a guess. |
| Program questions (RAG) <!-- STATUS: pending merge --> | Gemini `gemini-embedding-001` for vectors, cosine similarity in Node, answers built only from exact policy excerpts | About 200 chunks need no vector database. Offline there is a deterministic bag-of-words fallback. A question outside the documents is refused. |
| Fraud-ring signals <!-- STATUS: pending merge --> | SQL aggregates + a pure detector, no model | Counting shared accounts needs arithmetic, not a model. It only adds a flag for an officer. |
| Read-only assistant <!-- STATUS: pending merge --> | Tool calling through the same router, read-only tools | It can look things up; it cannot approve, pay or edit. |

**Profiles.** `AI_PROFILE=dev` (free Groq first), `demo` (paid Gemini first), `offline` (no outside AI: deterministic answers that route to a person). An admin can switch at runtime, and "Kill AI" forces the safe path at once.

## 3. Safety rules around the AI

- The model never approves, rejects or pays. It reads, classifies and phrases.
- Automation never rejects. It approves when very sure, asks for what is missing, or hands over to a person.
- What the phone reports (AI notes, the card check result) is treated as the client's word: it can move a claim toward an officer, never toward approval. Client-supplied confidence is capped.
- The first claim from a newly self-registered account always goes to an officer, because knowing a CNIC number proves nothing.
- CNICs and phone numbers are removed from text before it reaches a model.
- Message and document content is data, not instructions.

## 4. Honest limitations

**Data and accuracy**

- Everything was measured on synthetic data. Real-world accuracy is unknown and needs real, consented data.
- Scam recall was measured on template-generated scams that use the classic phrases the rule layer looks for. Recall on scams worded differently is not measured and will be lower.
- With the AI layer unavailable, an ordinary harmless message with no seal comes back "not sure" (10 of 14 in the fuzz run). Safe, but it means a person for most ordinary messages.
- A "not sure" scam verdict tells the citizen not to act and says an officer will look. It does not yet open a case in a fraud-desk queue.
- OCR reads the English side of the card only. Forgery detection is heuristic: it can miss a careful edit and can flag a re-saved genuine photo. That is why it only routes to an officer.
- One slip in a long name still matches (Shamim / Shamima, Tahir / Tahira). Spelling alone cannot tell a typo from another person; the CNIC is what separates people.

**Security and integrity**

- The audit chain detects edits, deletions and reordering inside the log, but not truncation of the newest entries. That needs an anchor kept outside the system.
- The seal check ignores spacing and letter case by design, and a look-alike Unicode character that lower-cases to the same letter also passes.
- The live fuzz harness has not been re-run against the final build. The last recorded runs (before the fixes) are in `docs/TESTING.md` with every finding.
- Open findings in `docs/TESTING.md`: a NUL character in a name or district answers 500 instead of 400; some gateway-level 4xx answers lack the request id; each new claim overwrites the stored name of the person.
- The payment property tests exercise a model built from the same pure functions, not the database code. The database path is covered by `pnpm e2e` and `pnpm chaos`.

**Product gaps**

- No versioned database migrations (`prisma db push`).
- The monthly request quota per program is reported, not enforced. There is no billing.
- No WhatsApp or email notifications; SMS is simulated.
- No screen for managing individual users and roles.
- Only one partner API route (scam check).
- Claim progress is saved on the phone only.
- The mock NADRA has no fault switch; its outage is covered by `pnpm chaos`, not by a button.
- Rule publishing is a single admin action (no second approver).
- The free Urdu voice is an unofficial endpoint and could change without notice.
- Free-tier model quotas can run out mid-demo. The system then falls back to the next provider and finally to "send it to a person".
