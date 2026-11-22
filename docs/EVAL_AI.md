# AI golden-set evaluation

`pnpm eval:ai` runs the AI service's existing claim extraction and scam-check tasks against versioned synthetic examples. It makes no database writes and does not send expected labels to a model.

## Run modes

The command requires dependencies, generated Prisma clients, a root `.env`, and a build. Create a local `.env` once with `pnpm keys` if it does not exist; add provider API keys there only for live runs. Then run `pnpm install`, `pnpm db:generate`, and `pnpm build`. From the repository root:

```powershell
# Offline safety regression; no vendor API calls
$env:AI_PROFILE = 'offline'
pnpm eval:ai

# One-provider judge runs. Set that provider's API key in the root .env first.
$env:AI_PROFILE = 'dev'
pnpm eval:ai -- --provider groq
pnpm eval:ai -- --provider gemini

# Optional paid demo Gemini comparison
$env:AI_PROFILE = 'demo'
pnpm eval:ai -- --provider gemini-demo
```

The evaluator prints JSON to stdout. Save each provider run separately (for example `groq.json` and `gemini.json`) and record the commit, model, profile, dataset hashes, and run date when sharing judge results. The report includes the provider and model actually used per call, fallback counts, and token usage when returned by the vendor. A missing key or vendor failure can lead to the safe mock provider; such a run is identified in provider attribution and should not be presented as a live model comparison.

## Data and metrics

- `services/ai/eval/golden/claims.jsonl`: 50 synthetic transcripts, with English, Urdu script, Roman Urdu, missing values, multiple/repeated names, two-CNIC ambiguity, and instruction-injection examples. CNICs use the reserved synthetic `99999-` prefix.
- `services/ai/eval/golden/scams.jsonl`: 40 synthetic messages, evenly split among valid program seals, forged seals, classic scams, and ordinary messages. The evaluator signs valid fixtures and tampers with forged fixtures at run time using a test-only secret; no production secret is read for those fixtures.
- Claim metrics include exact per-field accuracy, filled-value accuracy, missing-field detection, CNIC ambiguity, and human-review rate.
- Scam metrics include confusion counts, precision, recall, false-alarm rate, and abstentions. Sealed messages are settled by the production seal checker before any model call.
- Cold and cached passes report p50/p95 task latency and cache-hit counts. Predictions must match between passes.
- Provider output reports model, successful call count, fallback count, input/output token counts, and estimated cost where rates are configured.

The cold pass is the score-bearing pass. The second pass measures this service's in-process structured-response cache. Predictions must match between passes. Offline mock responses are intentionally not cached, so the offline run can report zero warm cache hits; use a configured provider run to measure response-cache hits. Vendor latency includes network time and will vary with network and provider load.

## Cost estimates

Set the following optional root `.env` values to the rates applicable to the selected model and date. Rates are USD per million tokens; the evaluator multiplies reported token counts by these values. `AI_EVAL_PRICING_AS_OF` records the date or pricing-page reference. Blank rates, missing token usage, and mock responses are reported distinctly; estimates are not invoices. Set rates only after checking the vendor's current pricing for the model used.

```dotenv
AI_EVAL_PRICING_AS_OF=
AI_EVAL_GROQ_INPUT_USD_PER_MILLION=
AI_EVAL_GROQ_OUTPUT_USD_PER_MILLION=
AI_EVAL_GEMINI_INPUT_USD_PER_MILLION=
AI_EVAL_GEMINI_OUTPUT_USD_PER_MILLION=
AI_EVAL_GEMINI_DEMO_INPUT_USD_PER_MILLION=
AI_EVAL_GEMINI_DEMO_OUTPUT_USD_PER_MILLION=
```

## Scope and result upload

CI runs the offline safety regression only, so it makes no external API calls and reports no live-provider accuracy. Live Groq/Gemini comparisons require their keys and are run manually with the commands above. Do not upload this report to the cases service: its current `/eval/run` endpoint evaluates the decision engine, and there is no agreed API contract for AI evaluation summaries yet. Keep the JSON output as a local judge artifact until the team defines that contract.

## RAG

"Ask about the program" (`POST /knowledge/ask`, also the `searchPolicy` tool of `POST /ai/assist`), measured with no embedding credit, so retrieval is local. Golden set: `services/knowledge/eval/golden.jsonl`, 47 questions: 38 answerable (English, Urdu script, Roman Urdu) and 9 that must be refused (cricket, football, weather, another person's CNIC, "approve my claim", two prompt injections). Run through the gateway as the demo citizen with `pnpm --filter @haqdaar/knowledge eval` (`KNOWLEDGE_EVAL_TOKEN` set).

| Metric (47 questions, live service)                             | Before | After |
| --------------------------------------------------------------- | ------ | ----- |
| Citation accuracy (answer cites an expected document), 38 cases | 0.526  | 1.000 |
| Refusal recall (out-of-scope questions refused), 9 cases        | 0.556  | 1.000 |
| Refusal precision (refused questions that should be refused)    | 0.357  | 1.000 |
| False refusal rate (answerable questions refused)               | 0.237  | 0.000 |
| Refusal classification accuracy, 47 cases                       | 0.723  | 1.000 |

- Before: the old 15-chunk corpus and the hashed bag-of-words ranking (`offline/hashed-bow-v1`), same 47 questions.
- After: the rewritten corpus (7 documents, 33 chunks) and local retrieval in `services/knowledge/src/retrieval/lexical.ts`: light English stemming, a table of about 40 concepts in English, Roman Urdu and Urdu script, heading and file-name words weighted 3x, BM25 ranking. The answer is 1 to 3 sentences from at most 2 chunks, word for word, in the language of the question (Roman Urdu is answered in Urdu).
- Refusal: the question is refused when fewer than 60% of its words are found in the best chunk (`KNOWLEDGE_LOCAL_COVERAGE`), or when it is an order ("approve my claim"), an instruction to ignore the documents, or a request for somebody's personal details. These are fixed patterns, not a model.
- Limits: the golden set was also used to tune the concept table and the section headings, so 1.000 is a fit to this set, not a held-out score. The Gemini-embedding path is unchanged and was not measured (no credit). A Roman Urdu question whose words are not in the concept table is refused rather than guessed.
