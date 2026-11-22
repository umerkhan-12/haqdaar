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
