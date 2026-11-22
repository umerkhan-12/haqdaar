# Policy knowledge service

The knowledge service answers questions from the synthetic bilingual documents in `docs/policy/`. It is informational and does not decide claim eligibility or payment. Answers consist only of exact policy excerpts, with a citation for every excerpt. Unsupported questions return a fixed bilingual refusal.

## Local setup

1. Add `KNOWLEDGE_DATABASE_URL` and `KNOWLEDGE_EMBEDDING_MODEL` from `.env.example` to the local `.env`. For a live index, configure a Gemini API key as well.
2. Generate and create the schema: `pnpm --filter @haqdaar/knowledge run db:generate`, then `pnpm --filter @haqdaar/knowledge run db:push`.
3. Build the services: `pnpm build`.
4. Start the stack with `pnpm dev` or `pnpm start`.
5. In a second terminal, run `pnpm knowledge:ingest`. The command reports the selected mode, model and vector dimension.

The live index needs a Gemini key (`GEMINI_API_KEY`, or `GEMINI_DEMO_API_KEY` in the `demo` profile): Groq has no embeddings. Without one, `pnpm knowledge:ingest` fails and leaves the existing index untouched.

Set `AI_PROFILE=offline` before `pnpm knowledge:ingest` for deterministic hashed bag-of-words vectors without a vendor key. Re-ingest after changing between offline and Gemini index modes. In offline mode, cross-language matching is limited to shared words and is less capable than Gemini semantic embeddings. If Kill AI is active while a Gemini index is loaded, retrieval uses local lexical matching and never calls a model. The same local path answers whenever live embeddings cannot be had: the AI service is down, there is no Gemini key or quota, or the index was built in another mode. Local answers are the best-matching policy sentences, word for word; out-of-scope questions are still refused.

`pnpm knowledge:ingest` reads Markdown headings and estimates token cost as one token per four Unicode code points per word (minimum one), targeting 400 estimated tokens with 50 estimated tokens of overlap. This is deterministic but is not a model tokenizer. Each chunk retains its stable source heading. Chunk hashes avoid re-embedding unchanged content. Removed documents and stale chunks are deleted in the same transaction that activates the new model/mode index.

After building and starting the stack, set `KNOWLEDGE_EVAL_TOKEN` to a short-lived local token for an authorized citizen/helper/officer, then run `pnpm knowledge:eval`. It prints citation-document accuracy, refusal classification accuracy, refusal recall and false-refusal rate for the 15-question golden set. Adjust `KNOWLEDGE_RELEVANCE_THRESHOLD` (live default `0.32`) and `KNOWLEDGE_OFFLINE_THRESHOLD` (offline default `0.12`) in `.env`, restart knowledge, and repeat the evaluation to tune thresholds. These are initial thresholds; record actual output from your run and do not treat this code change as an accuracy result.

## Model and index compatibility

Google retired `text-embedding-004`; the service defaults to `gemini-embedding-001` through `KNOWLEDGE_EMBEDDING_MODEL`. That is a necessary update from the original issue brief. If the model changes, ingestion rebuilds the index. Retrieval refuses a dimension or model mismatch. Vectors are stored as PostgreSQL `Float[]` and cosine similarity runs in Node; pgvector is not required.

Gemini embeddings run through the AI provider router, profile and circuit breaker. API keys remain in the AI service. The knowledge service calls AI with a short-lived internal token. Citizen questions are redacted before embedding and prompting. Retrieved policy content is treated as untrusted data. The answer task can select only exact source excerpts, and the knowledge service checks each citation again before returning it.

## HTTP contract and manual demo

Through the gateway, `POST /knowledge/ask` accepts `{"question":"How much is the monthly demo amount?"}` for citizen, helper or officer roles and returns:

```json
{
  "answer": "The current synthetic contract shows PKR 12,000 per month. ...",
  "citations": [{ "docId": "payment-schedule", "heading": "schedule.amount", "quote": "..." }],
  "refused": false
}
```

Use a real user bearer token from the local login route. Then try `{"question":"What is the cricket score today?"}`; it should return `refused: true` and no citations. Also try the injection question q13 in `services/knowledge/eval/golden.jsonl`; its answer must quote only the supported PKR 12,000 policy sentence. The test-only malicious policy fixture under `services/knowledge/eval/fixtures/` is intentionally outside the ingestion directory.

The 15 synthetic questions in `services/knowledge/eval/golden.jsonl` cover English, Urdu, in-scope questions, refusals, prompt injection and a synthetic CNIC. Report relevant-document retrieval, exact citation correctness and refusal accuracy separately when evaluating a model run; do not claim those metrics until the set has actually been run.
