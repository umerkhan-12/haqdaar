import '../env';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { sealMessage } from '@haqdaar/nest-kit';
import { AiRouter, type ProviderRoutes } from '../router/ai-router';
import { GroqProvider } from '../providers/groq.provider';
import { GeminiProvider } from '../providers/gemini.provider';
import { MockProvider } from '../providers/mock.provider';
import { env } from '../env';
import { extractClaim } from '../tasks/extract-claim';
import { scamCheck } from '../tasks/scam-check';
import { clearStructuredCache } from '../tasks/structured';
import { redactPii } from '../tasks/pii';

const TEST_SEAL_SECRET = 'haqdaar-ai-eval-test-only-secret-v1';
const FIXTURE_EXPIRY = new Date('2099-12-31T00:00:00.000Z');
const ClaimGolden = z.object({
  id: z.string().min(1),
  transcript: z.string().min(1).max(4000),
  expected: z.object({
    fullName: z.string().nullable(),
    cnic: z.string().regex(/^\d{5}-\d{7}-\d$/).nullable(),
    district: z.string().nullable(),
    householdSize: z.number().int().min(1).max(30).nullable(),
    intent: z.enum(['claim_payment', 'check_status', 'report_scam', 'complaint', 'other']),
    cnicAmbiguous: z.boolean().optional(),
  }).strict(),
}).strict();
const ScamGolden = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2000),
  fixture: z.enum(['valid', 'forged', 'none']),
  expected: z.enum(['GENUINE', 'SCAM', 'UNSURE']),
  category: z.enum(['genuine_seal', 'fake_seal', 'classic_scam', 'ordinary']),
}).strict();

type ClaimCase = z.infer<typeof ClaimGolden>;
type ScamCase = z.infer<typeof ScamGolden>;
type AiCallMeta = NonNullable<Awaited<ReturnType<typeof extractClaim>>['meta']['calls']>[number];

const fields = ['fullName', 'cnic', 'district', 'householdSize', 'intent'] as const;
const args = process.argv.slice(2);
const providerArg = valueAfter('--provider');
const providerIds = ['groq', 'gemini', 'gemini-demo'] as const;
if (args.includes('--provider') && !providerArg) {
  throw new Error(`--provider requires one of: ${providerIds.join(', ')}`);
}
if (providerArg && !providerIds.includes(providerArg as (typeof providerIds)[number])) {
  throw new Error(`--provider must be one of: ${providerIds.join(', ')}`);
}
if (providerArg && env.AI_PROFILE === 'offline') {
  throw new Error('Provider selection requires AI_PROFILE=dev or demo; offline mode never calls a vendor.');
}

const providers = providerArg
  ? [
      ...(providerArg === 'groq' ? [new GroqProvider(env.GROQ_API_KEY, env.GROQ_LLM_MODEL, env.GROQ_STT_MODEL)] : []),
      ...(providerArg === 'gemini' ? [new GeminiProvider('gemini', env.GEMINI_API_KEY, env.GEMINI_MODEL)] : []),
      ...(providerArg === 'gemini-demo' ? [new GeminiProvider('gemini-demo', env.GEMINI_DEMO_API_KEY, env.GEMINI_MODEL)] : []),
      new MockProvider(),
    ]
  : [
      new GroqProvider(env.GROQ_API_KEY, env.GROQ_LLM_MODEL, env.GROQ_STT_MODEL),
      new GeminiProvider('gemini', env.GEMINI_API_KEY, env.GEMINI_MODEL),
      new GeminiProvider('gemini-demo', env.GEMINI_DEMO_API_KEY, env.GEMINI_MODEL),
      new MockProvider(),
    ];
const routeOverrides: ProviderRoutes = providerArg ? { llm: [providerArg] } : {};
const router = new AiRouter(env.AI_PROFILE, providers, undefined, routeOverrides);

async function main() {
  const claimsRaw = await readFile(resolve(process.cwd(), 'eval/golden/claims.jsonl'), 'utf8');
  const scamsRaw = await readFile(resolve(process.cwd(), 'eval/golden/scams.jsonl'), 'utf8');
  const claims = parseJsonl(claimsRaw, ClaimGolden, 'claims');
  const scams = parseJsonl(scamsRaw, ScamGolden, 'scams');
  validateDatasets(claims, scams);

  clearStructuredCache();
  const cold = await runPass(claims, scams);
  const cached = await runPass(claims, scams);
  const cacheConsistent = JSON.stringify(cold.predictions) === JSON.stringify(cached.predictions);
  if (!cacheConsistent) throw new Error('Cold and cached predictions differ');

  const liveCalls = cold.usage.filter((call) => call.provider !== 'mock');
  const measured = env.AI_PROFILE !== 'offline' && liveCalls.length > 0;
  const report = {
    generatedAt: new Date().toISOString(),
    profile: env.AI_PROFILE,
    providerSelection: providerArg ?? 'active-profile-chain',
    mode: env.AI_PROFILE === 'offline' ? 'offline_safety_validation' : measured ? 'live_provider_evaluation' : 'no_live_provider_available',
    taskVersions: { extraction: 'extract_claim@v1', scam: 'scam_check@v1' },
    datasets: {
      claims: { count: claims.length, sha256: sha(claimsRaw) },
      scams: { count: scams.length, sha256: sha(scamsRaw) },
    },
    metrics: measured ? { extraction: extractionMetrics(claims, cold.claims), scams: scamMetrics(scams, cold.scams) } : null,
    safety: env.AI_PROFILE === 'offline' ? offlineSafety(claims, cold.claims, scams, cold.scams) : null,
    latencyMs: {
      cold: { extraction: latency(cold.claimLatency), scam: latency(cold.scamLatency) },
      cached: { extraction: latency(cached.claimLatency), scam: latency(cached.scamLatency) },
    },
    cache: {
      coldHits: cold.cacheHits,
      cachedPassHits: cached.cacheHits,
      predictionsMatch: cacheConsistent,
    },
    providers: providerMetrics(cold.usage),
    pricing: {
      basis: process.env.AI_EVAL_PRICING_AS_OF || null,
      ratesAreEstimates: true,
      note: 'Estimated API cost uses optional environment rates and reported tokens; it is not a billed amount.',
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.safety && Object.values(report.safety).some((value) => value !== true)) process.exitCode = 1;
}

async function runPass(claims: ClaimCase[], scams: ScamCase[]) {
  const claimResults = [] as Awaited<ReturnType<typeof extractClaim>>[];
  const scamResults = [] as Awaited<ReturnType<typeof scamCheck>>[];
  const claimLatency: number[] = [];
  const scamLatency: number[] = [];
  const usage: AiCallMeta[] = [];
  let cacheHits = 0;
  const predictions: unknown[] = [];

  for (const item of claims) {
    const start = performance.now();
    const result = await extractClaim(router, item.transcript);
    claimLatency.push(performance.now() - start);
    claimResults.push(result);
    if (result.meta.cached) cacheHits++;
    usage.push(...(result.meta.calls ?? []));
    predictions.push({ extraction: result.extraction, needsHuman: result.needsHuman, reason: result.reason });
  }
  for (const item of scams) {
    const message = buildFixture(item);
    const start = performance.now();
    const result = await scamCheck(router, message, TEST_SEAL_SECRET);
    scamLatency.push(performance.now() - start);
    scamResults.push(result);
    if (result.meta?.cached) cacheHits++;
    usage.push(...(result.meta?.calls ?? []));
    predictions.push({ verdict: result.verdict, confidence: result.confidence, sealValid: result.sealValid, redFlags: result.redFlags });
  }
  return { claims: claimResults, scams: scamResults, claimLatency, scamLatency, usage, cacheHits, predictions };
}

function buildFixture(item: ScamCase) {
  if (item.fixture === 'none') return item.text;
  const sealed = sealMessage(item.text, TEST_SEAL_SECRET, FIXTURE_EXPIRY);
  if (item.fixture === 'valid') return sealed;
  return sealed.replace(/([A-Z2-7])(?=\n?\s*$)/, (letter) => letter === 'A' ? 'B' : 'A');
}

function extractionMetrics(cases: ClaimCase[], results: Awaited<ReturnType<typeof extractClaim>>[]) {
  const byField = Object.fromEntries(fields.map((field) => {
    let correct = 0;
    let total = 0;
    let filledCorrect = 0;
    let filledTotal = 0;
    for (let i = 0; i < cases.length; i++) {
      const expected = cases[i]!.expected[field];
      const actual = results[i]!.extraction?.[field] ?? null;
      total++;
      if (equalField(field, actual, expected)) correct++;
      if (expected !== null) {
        filledTotal++;
        if (equalField(field, actual, expected)) filledCorrect++;
      }
    }
    return [field, { correct, total, accuracy: ratio(correct, total), filledAccuracy: ratio(filledCorrect, filledTotal), expectedFilled: filledTotal }];
  }));
  const missing = cases.flatMap((item, i) => fields.filter((field) => field !== 'intent' && item.expected[field] === null)
    .map((field) => ({ field, detected: results[i]!.extraction?.missingFields.includes(field) ?? true })));
  const ambiguous = cases.map((item, i) => ({
    expected: item.expected.cnicAmbiguous ?? false,
    detected: results[i]!.extraction?.missingFields.includes('cnic_ambiguous') ?? false,
  }));
  return {
    perField: byField,
    aggregateAccuracy: ratio(Object.values(byField).reduce((sum, value) => sum + value.correct, 0), Object.values(byField).reduce((sum, value) => sum + value.total, 0)),
    missingFieldDetection: ratio(missing.filter((item) => item.detected).length, missing.length),
    expectedMissingFieldCount: missing.length,
    cnicAmbiguityAccuracy: ratio(ambiguous.filter((item) => item.expected === item.detected).length, ambiguous.length),
    needsHumanCount: results.filter((result) => result.needsHuman).length,
    needsHumanRate: ratio(results.filter((result) => result.needsHuman).length, results.length),
  };
}

function scamMetrics(cases: ScamCase[], results: Awaited<ReturnType<typeof scamCheck>>[]) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let abstentions = 0;
  for (let i = 0; i < cases.length; i++) {
    const expectedScam = cases[i]!.expected === 'SCAM';
    const actual = results[i]!.verdict;
    if (actual === 'UNSURE') abstentions++;
    if (expectedScam && actual === 'SCAM') tp++;
    else if (expectedScam && actual !== 'SCAM') fn++;
    else if (!expectedScam && actual === 'SCAM') fp++;
    else if (!expectedScam && actual === 'GENUINE') tn++;
  }
  const nonScams = cases.filter((item) => item.expected !== 'SCAM').length;
  return {
    confusion: { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn },
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falseAlarmRate: ratio(fp, nonScams),
    abstentions,
    abstentionRate: ratio(abstentions, results.length),
    examples: results.length,
  };
}

function offlineSafety(claimCases: ClaimCase[], claimResults: Awaited<ReturnType<typeof extractClaim>>[], scamCases: ScamCase[], scamResults: Awaited<ReturnType<typeof scamCheck>>[]) {
  return {
    claimsAlwaysGoToHuman: claimResults.every((result) => result.needsHuman && result.extraction === null),
    validSealsAccepted: scamCases.every((item, i) => item.fixture !== 'valid' || (scamResults[i]!.verdict === 'GENUINE' && scamResults[i]!.sealValid === true)),
    forgedSealsRejected: scamCases.every((item, i) => item.fixture !== 'forged' || (scamResults[i]!.verdict === 'SCAM' && scamResults[i]!.sealValid === false)),
    unsealedMessagesNeverAutoMarkedGenuine: scamCases.every((item, i) => item.fixture !== 'none' || scamResults[i]!.verdict !== 'GENUINE'),
    allClaimsAccountedFor: claimCases.length === claimResults.length,
  };
}

function providerMetrics(calls: AiCallMeta[]) {
  const groups = new Map<string, { provider: string; model: string; calls: number; fallbacks: number; inputTokens: number; outputTokens: number; missingUsage: number; mock: boolean }>();
  for (const call of calls) {
    const key = `${call.provider}/${call.model}`;
    const group = groups.get(key) ?? { provider: call.provider, model: call.model, calls: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0, missingUsage: 0, mock: call.provider === 'mock' };
    group.calls++;
    if (call.fallbackUsed) group.fallbacks++;
    if (call.inputTokens === undefined || call.outputTokens === undefined) group.missingUsage++;
    else {
      group.inputTokens += call.inputTokens;
      group.outputTokens += call.outputTokens;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const prefix = group.provider.toUpperCase().replace(/-/g, '_');
    const inputRate = optionalRate(`AI_EVAL_${prefix}_INPUT_USD_PER_MILLION`);
    const outputRate = optionalRate(`AI_EVAL_${prefix}_OUTPUT_USD_PER_MILLION`);
    const estimatedCostUsd = group.mock || group.missingUsage || inputRate === null || outputRate === null
      ? null
      : Number(((group.inputTokens * inputRate + group.outputTokens * outputRate) / 1_000_000).toFixed(8));
    return { ...group, estimatedCostUsd, pricingConfigured: !group.mock && inputRate !== null && outputRate !== null };
  });
}

function parseJsonl<T>(content: string, schema: z.ZodType<T>, name: string): T[] {
  const rows = content.split(/\r?\n/).filter((line) => line.trim());
  return rows.map((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); }
    catch (error) { throw new Error(`${name}.jsonl line ${index + 1} is invalid JSON: ${String(error)}`); }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error(`${name}.jsonl line ${index + 1} is invalid: ${parsed.error.message}`);
    return parsed.data;
  });
}

function validateDatasets(claims: ClaimCase[], scams: ScamCase[]) {
  if (claims.length !== 50 || scams.length !== 40) throw new Error(`Expected 50 claims and 40 scam messages; got ${claims.length} and ${scams.length}`);
  const unique = (ids: string[], name: string) => { if (new Set(ids).size !== ids.length) throw new Error(`${name} IDs must be unique`); };
  unique(claims.map((item) => item.id), 'Claim');
  unique(scams.map((item) => item.id), 'Scam');
  if (claims.some((item) => item.expected.cnic && !item.expected.cnic.startsWith('99999-'))) throw new Error('Claim labels may contain synthetic CNICs only');
  if (claims.some((item) => redactPii(item.transcript).cnics.some((cnic) => !cnic.startsWith('99999-')))) throw new Error('Claim transcripts may contain synthetic CNICs only');
  const categories = Object.fromEntries(['genuine_seal', 'fake_seal', 'classic_scam', 'ordinary'].map((category) => [category, scams.filter((item) => item.category === category).length]));
  if (Object.values(categories).some((count) => count !== 10)) throw new Error(`Expected 10 scam records per category; got ${JSON.stringify(categories)}`);
  if (scams.some((item) => (item.category === 'genuine_seal') !== (item.fixture === 'valid') || (item.category === 'fake_seal') !== (item.fixture === 'forged'))) {
    throw new Error('Scam categories and deterministic seal fixture labels do not match');
  }
  if (scams.some((item) => (item.category === 'genuine_seal' || item.category === 'ordinary') !== (item.expected === 'GENUINE'))) {
    throw new Error('Scam category and expected verdict labels do not match');
  }
}

function equalField(field: (typeof fields)[number], actual: unknown, expected: unknown) {
  if (field !== 'fullName' || actual === null || expected === null || typeof actual !== 'string' || typeof expected !== 'string') return actual === expected;
  return actual.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase() === expected.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function latency(xs: number[]) {
  return { p50Ms: quantile(xs, 0.5), p95Ms: quantile(xs, 0.95), count: xs.length };
}
function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil((sorted.length - 1) * q)]!.toFixed(1));
}
function ratio(numerator: number, denominator: number) { return denominator ? Number((numerator / denominator).toFixed(4)) : null; }
function sha(value: string) { return createHash('sha256').update(value).digest('hex'); }
function optionalRate(name: string) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}
function valueAfter(flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((error) => { console.error('AI golden evaluation failed:', error); process.exitCode = 1; });
