import { clearSession, getSession, saveSession, sessionFrom, type Tokens } from './session';

/** Same-origin by default (`/api` is rewritten to the gateway), so phones on the LAN work. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Every failure the UI can show. `status 0` = no network (the phone is offline). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

interface Options {
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  headers?: Record<string, string>;
  token?: string;
}

/** Weak signal: a request that gets no answer in this time counts as "no network", so the UI can save and retry. */
const TIMEOUT_MS = 30_000;

let refreshing: Promise<boolean> | null = null;

/** Refresh-token rotation; concurrent 401s share one refresh. */
async function refresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
      });
      if (!res.ok) return false;
      saveSession(sessionFrom((await res.json()) as Tokens, s.familyLabel));
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function request<T>(
  method: string,
  path: string,
  o: Options = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = { ...o.headers };
  const token = o.token ?? (o.auth === false ? undefined : getSession()?.accessToken);
  if (token) headers.authorization = `Bearer ${token}`;
  if (o.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, 'offline', 'OFFLINE');
  }

  if (res.status === 401 && token && !o.token && !retried) {
    if (await refresh()) return request<T>(method, path, o, true);
    clearSession();
  }

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const b = (data ?? {}) as { message?: string; details?: { code?: string }; requestId?: string };
    throw new ApiError(res.status, b.message ?? res.statusText, b.details?.code, b.requestId);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export const items = <T>(b: unknown): T[] =>
  Array.isArray(b) ? (b as T[]) : ((b as { items?: T[] })?.items ?? []);

// ---------- shapes ----------
export type Lane = 'AUTO_APPROVE' | 'ASK_MORE' | 'HUMAN_REVIEW';
export type CaseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'NEEDS_INFO'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'CLOSED';

export interface CaseSummary {
  id: string;
  type: string;
  status: CaseStatus;
  lane: Lane | null;
  confidence: number | null;
  amount: number | null;
  flags: string[];
  createdAt: string;
  priority?: number;
  district?: string;
  waitingMinutes?: number;
}

export interface Decision {
  id: string;
  lane: Lane;
  confidence: number;
  eligible: boolean;
  clauses:
    | { id: string; passed?: boolean; ok?: boolean; textUr?: string; textEn?: string }[]
    | Record<string, boolean>;
  hardFlags: string[];
  explanationUr: string;
  explanationEn: string;
  decidedBy: 'system' | 'officer';
}

export interface CaseDetail extends CaseSummary {
  person: { id: string; fullName: string; cnicMasked: string; district: string | null };
  payout: { ibanMasked: string | null; aliasMasked: string | null };
  decision: Decision | null;
  timeline: { type: string; actor: string; data: unknown; at: string }[];
}

export interface ClaimInput {
  type: 'relief_claim';
  fullName: string;
  cnic: string;
  district?: string;
  householdSize?: number;
  payout: { alias?: string; iban?: string };
  /** What the AI heard and how sure it was: the officer's case notes on a handoff. */
  extraction?:
    | (Partial<NonNullable<Extraction['extraction']>> & {
        transcript?: string;
        needsHuman?: boolean;
        reason?: string;
      })
    | null;
  /** CNIC photo check; null = she skipped the photo. */
  documentCheck?: DocumentCheck | null;
}

export interface Extraction {
  extraction: {
    intent: string;
    fullName: string | null;
    cnic: string | null;
    phone: string | null;
    district: string | null;
    householdSize: number | null;
    isWidow: boolean | null;
    missingFields: string[];
    confidence: number;
  } | null;
  needsHuman: boolean;
  reason?: string;
}

export interface ScamVerdict {
  verdict: 'GENUINE' | 'SCAM' | 'UNSURE';
  confidence: number;
  sealValid: boolean | null;
  redFlags: string[];
  explanationUr: string;
  explanationEn: string;
}

export interface DocumentCheck {
  cnicFromOcr: string | null;
  cnicFromQr: string | null;
  /** Printed fields read off the card (official spelling); null when the card could not be read. */
  fields?: { name?: string | null } | null;
  checks: { id: string; ok: boolean; detail: string }[];
  forgeryScore: number;
  blurScore: number;
  needsHuman: boolean;
  retakeRequired: boolean;
  explanationUr: string;
  explanationEn: string;
}

export interface Payment {
  id: string;
  caseId: string;
  state: string;
  amount: number;
  creditorName: string;
  creditorAlias: string | null;
  holdReason: string | null;
  titleFetched: string | null;
  titleMatchScore: number | null;
  makerId: string;
  createdAt: string;
}

export interface RuleVersion {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  amount: number;
  notes: string | null;
  clauses: { id: string; logic: unknown; textUr: string; textEn: string }[];
}

export interface Simulation {
  casesReplayed: number;
  changedCount: number;
  before: Record<Lane, number>;
  after: Record<Lane, number>;
  changed: { caseId: string; from: Lane; to: Lane }[];
}

export interface AiStatus {
  profile: 'dev' | 'demo' | 'offline';
  description: string;
  killed: boolean;
  llm: { provider: string; configured: boolean; circuit: string }[];
  stt: { provider: string; configured: boolean; circuit: string }[];
  stats: { calls: number; failures: number; fallbacks: number; mockAnswers: number };
}

export interface AuditEntry {
  seq: number;
  eventId: string;
  type: string;
  source: string;
  actorId: string | null;
  entityId: string | null;
  occurredAt: string;
  hash: string;
  payload: unknown;
}

export interface Scenario {
  id: string;
  challenge: string;
  title: string;
  proves: string;
}

export interface ScenarioResult extends Scenario {
  ok: boolean;
  summary: string;
  durationMs: number;
  steps: { label: string; ok: boolean; ms: number; detail?: string; data?: unknown }[];
}

/** One permission row. A purpose can have several rows; it is in force while any row is ACTIVE. */
export interface Consent {
  id: string;
  personId: string;
  purpose: string;
  status: 'ACTIVE' | 'WITHDRAWN';
  grantedAt: string;
  withdrawnAt: string | null;
}

/** The facts a citizen can report as wrong (closed list: one big button each). */
export type CorrectionField = 'name' | 'cnic' | 'district' | 'household';

// ---------- staff visibility pages (eval, tenants, API docs, webhooks, rail faults) ----------
/** Headline of one offline evaluation on the synthetic labelled set. */
export interface EvalHeadline {
  testCases: number;
  datasetSeed: number;
  datasetSize: number;
  threshold: number;
  routingAccuracy: number;
  accuracyOnDecided: number;
  automationRate: number;
  falseAlarms: number;
  wrongAutoApprovals: number;
  wrongAutoApprovalRate: number;
  costPerCase: number;
  costPerCaseAllHuman: number;
  rawEce: number;
  calibratedEce: number;
}

export interface EvalCosts {
  wrongApproval: number;
  humanReview: number;
  askMore: number;
  threshold: number;
  amountCap: number;
}

export interface EvalRunRow {
  id: string;
  createdAt: string;
  createdBy: string;
  datasetSeed: number;
  datasetSize: number;
  costs: EvalCosts;
  headline: EvalHeadline;
}

export interface EvalMetrics {
  cases: number;
  lanes: { n: number; autoApprove: number; askMore: number; humanReview: number };
  falseAlarms: { count: number; rateOfPayable: number; byReason: Record<string, number> };
  fraudCaught: { of: number; caught: number; recall: number };
  wrongAutoApprovals: { count: number; rate: number; upper95: number };
  cost: { total: number; perCase: number; allHumanPerCase: number };
}

/** Full report of one run (only the parts the dashboard draws are typed). */
export interface EvalRun extends Omit<EvalRunRow, 'createdBy' | 'datasetSeed' | 'datasetSize'> {
  metrics: EvalMetrics;
  rawBaseline: EvalMetrics;
  calibration: {
    method: string;
    reliability: {
      bin: number;
      n: number;
      from: number;
      to: number;
      observed: number;
      predicted: number;
    }[];
  };
}

/** Live numbers from real claims plus the last evaluation's headline. */
export interface EvalSummary {
  at: string;
  claims: { total: number; byStatus: Partial<Record<CaseStatus, number>> };
  lanes: {
    decided: number;
    AUTO_APPROVE: number;
    HUMAN_REVIEW: number;
    ASK_MORE: number;
    automationRate: number | null;
  };
  queue: {
    size: number;
    inReview: number;
    needsInfo: number;
    waitingMinutes: { median: number | null; p90: number | null; max: number | null };
  };
  timeToMoney: {
    definition: string;
    paidCases: number;
    medianSeconds: number | null;
    p90Seconds: number | null;
    medianSecondsAutoApproved: number | null;
    medianSecondsOfficerApproved: number | null;
  };
  lastEval: (EvalHeadline & { id: string; createdAt: string }) | null;
}

/** /ai/status including the per-provider latency counters the eval dashboard shows. */
export type AiQuality = AiStatus & {
  stats: AiStatus['stats'] & { byProvider?: Record<string, { calls: number; totalMs: number }> };
};

export interface Tenant {
  id: string;
  name: string;
  type: 'relief' | 'fraud_desk';
  monthlyRequestQuota: number;
  createdAt: string;
  users?: number;
}

export interface TenantUsage {
  tenant: Tenant;
  from: string;
  to: string;
  totals: { requests: number; errors: number; aiCalls: number };
  quota: {
    monthlyRequestQuota: number;
    monthToDateRequests: number;
    percentUsed: number;
    exceeded: boolean;
  };
  daily: { day: string; requests: number; errors: number; aiCalls: number }[];
  note: string;
}

export interface LaunchProgramInput {
  programName: string;
  type: Tenant['type'];
  adminName: string;
  adminPhone: string;
  adminPassword: string;
  monthlyRequestQuota?: number;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export type RaastFaultMode =
  'none' | 'fail' | 'timeout' | 'timeout_after_debit' | 'duplicate_statement';
/** Fault injected into the mock Raast rail (Judge Mode). */
export interface RailFaults {
  raast: { mode: RaastFaultMode; remaining: number; alias?: string };
}

/** Where the gateway republishes each service's Swagger UI (same origin, under the API prefix). */
export const docsUrl = (service: string): string => `${BASE}/docs/${service}`;
/** Public API base shown in copy-paste examples. */
export const API_BASE = BASE;
// ---------- end staff visibility pages ----------

// ---------- officer + auditor package (case management, AI notes, readable audit) ----------
/** What the AI heard and saw, as stored with the case: masked like the rest of the case view. */
export interface AiNotes {
  extraction: {
    transcript: string | null;
    intent: string | null;
    fullName: string | null;
    cnicMasked: string | null;
    cnicMatchesClaim: boolean | null;
    phoneMasked: string | null;
    district: string | null;
    householdSize: number | null;
    isWidow: boolean | null;
    missingFields: string[];
    confidence: number | null;
    needsHuman: boolean;
    reason: string | null;
  } | null;
  documentStatus: 'checked' | 'skipped' | 'not_sent';
  documentCheck: {
    cnicFromOcrMasked: string | null;
    ocrMatchesClaim: boolean | null;
    cnicFromQrMasked: string | null;
    qrMatchesClaim: boolean | null;
    checks: { id: string; ok: boolean; detail: string | null }[];
    forgeryScore: number | null;
    blurScore: number | null;
    needsHuman: boolean;
    retakeRequired: boolean;
    explanationEn: string | null;
    explanationUr: string | null;
  } | null;
}

/** Queue row with the case-management fields. */
/** A fraud-ring signal on a case. Staff only: the citizen's view never carries it. */
export interface Anomaly {
  type: string;
  evidenceCaseIds: string[];
  observedCount: number;
  threshold: number;
  windowStart: string;
  windowEnd: string;
}

/** Result of `POST /cases/anomaly-scan`. */
export interface AnomalyScan {
  scannedCases: number;
  signalsDetected: number;
  findingsCreated: number;
  findingsUpdated: number;
  findings: Anomaly[];
}

/** One tool the Ask assistant ran for her, shown as a "what I checked" chip. */
export interface AssistStep {
  tool: 'searchPolicy' | 'getMyClaims' | 'getMyPayments' | 'checkMessage';
  ok: boolean;
  ms: number;
}

/** Answer of `POST /ai/assist`. `refused` = "I am not sure, ask a helper or an officer". */
export interface AssistAnswer {
  answer: string;
  lang: 'ur' | 'en';
  refused: boolean;
  planner: 'model' | 'keywords';
  steps: AssistStep[];
  sources: { docId: string; heading: string; quote: string }[];
  scam: 'GENUINE' | 'SCAM' | 'UNSURE' | null;
}

export interface QueueCase extends CaseSummary {
  anomalies?: Anomaly[];
  assignedTo: string | null;
  escalated: boolean;
  escalatedAt: string | null;
}

/** Case detail as staff see it: AI notes, assignee, escalation and the rule the decision was made under. */
export interface StaffCase
  extends Omit<CaseDetail, 'decision'>, Omit<QueueCase, keyof CaseSummary> {
  escalationReason: string | null;
  aiNotes: AiNotes;
  decision:
    | (Decision & {
        ruleVersion: number | null;
        threshold: number;
        clauseTexts: Record<string, string>;
        at: string;
      })
    | null;
}

/** Raw decision record for auditors (`GET /decisions/:id/trace`). */
export interface DecisionTrace {
  decision: {
    id: string;
    caseId: string;
    lane: Lane;
    confidence: number;
    threshold: number | null;
    eligible: boolean | null;
    clausesHit: { id: string; passed: boolean }[];
    hardFlags: string[];
    explanationEn: string;
    explanationUr: string;
    inputs: unknown;
    decidedBy: string;
    createdAt: string;
  };
  ruleVersion: {
    id: string;
    version: number;
    status: string;
    amount: number;
    clauses: { id: string; textEn: string; textUr: string }[];
  } | null;
}

export interface AuditStats {
  total: number;
  last24h: Record<string, number>;
  lastSeq: number | null;
  lastRecordedAt: string | null;
}

// ---------- endpoints ----------
export const api = {
  login: (phone: string, password: string) =>
    request<Tokens>('POST', '/auth/login', { body: { phone, password }, auth: false }),
  logout: (refreshToken: string) =>
    request<void>('POST', '/auth/logout', { body: { refreshToken }, auth: false }),
  // sign-up (citizen): SMS code → name + PIN → same tokens as login
  signupStart: (phone: string) =>
    request<{ sent: true }>('POST', '/auth/signup/start', { body: { phone }, auth: false }),
  signupVerify: (body: { phone: string; code: string; fullName: string; pin: string }) =>
    request<Tokens>('POST', '/auth/signup/verify', { body, auth: false }),
  /** PROTOTYPE: the simulated sign-up SMS, shown on the sign-up screen (there is no real phone). */
  signupSms: (phone: string) =>
    request<{ simulated: true; message: { body: string; receivedAt: string } | null }>(
      'GET',
      `/mock/sms/signup/${phone}`,
      { auth: false },
    ),
  families: (token?: string) =>
    request<{ personId: string; label: string; locked: boolean }[]>('GET', '/auth/families', {
      token,
    }),
  actFor: (personId: string, pin: string, token?: string) =>
    request<Tokens>('POST', '/auth/act-for', { body: { personId, pin }, token }),

  consents: () => request<Consent[]>('GET', '/consents'),
  grantConsent: (personId: string, purpose: string) =>
    request<Consent>('POST', '/consents', { body: { personId, purpose } }),
  withdrawConsent: (id: string) => request<Consent>('POST', `/consents/${id}/withdraw`),
  /** "My information is wrong": files an audited request; an officer corrects the record after checking. */
  requestCorrection: (field: CorrectionField, note?: string) =>
    request<{ requestId: string; field: CorrectionField; status: 'RECEIVED'; at: string }>(
      'POST',
      '/consents/correction-request',
      {
        body: { field, ...(note ? { note } : {}) },
      },
    ),

  submitClaim: (claim: ClaimInput, idempotencyKey: string) =>
    request<CaseDetail>('POST', '/cases', {
      body: claim,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  resubmit: (id: string) => request<CaseDetail>('POST', `/cases/${id}/resubmit`),
  cases: () => request<CaseSummary[]>('GET', '/cases'),
  case: (id: string) => request<CaseDetail>('GET', `/cases/${id}`),
  queue: () => request<CaseSummary[]>('GET', '/queue'),
  approve: (id: string, note?: string) =>
    request('POST', `/cases/${id}/approve`, { body: { note } }),
  reject: (id: string, reason: string) =>
    request('POST', `/cases/${id}/reject`, { body: { reason } }),
  requestInfo: (id: string, message: string) =>
    request('POST', `/cases/${id}/request-info`, { body: { message } }),
  trace: (decisionId: string) =>
    request<{ decision: unknown; ruleVersion: unknown }>('GET', `/decisions/${decisionId}/trace`),

  transcribe: (audio: Blob) => {
    const form = new FormData();
    form.append('file', audio, 'claim.webm');
    return request<{ text: string; understood: boolean }>('POST', '/ai/transcribe', { form });
  },
  documentCheck: (photo: Blob, cnic?: string) => {
    const form = new FormData();
    form.append('file', photo, photo.type === 'image/png' ? 'cnic.png' : 'cnic.jpg');
    if (cnic) form.append('cnic', cnic);
    return request<DocumentCheck>('POST', '/ai/document-check', { form });
  },
  extract: (transcript: string) =>
    request<Extraction>('POST', '/ai/extract-claim', { body: { transcript } }),
  /** Ask Haqdaar: policy answers with sources, or her own claim / payment / message checked by tools. */
  assist: (question: string, lang: 'ur' | 'en') =>
    request<AssistAnswer>('POST', '/ai/assist', { body: { question, lang } }),
  /** Officer/admin: look for fraud rings across the program's open claims. */
  anomalyScan: () => request<AnomalyScan>('POST', '/cases/anomaly-scan'),
  scamCheck: (text: string) => request<ScamVerdict>('POST', '/ai/scam-check', { body: { text } }),
  aiStatus: () => request<AiStatus>('GET', '/ai/status'),
  setKill: (killed: boolean) => request<AiStatus>('POST', '/ai/kill-switch', { body: { killed } }),
  setProfile: (profile: AiStatus['profile']) =>
    request<AiStatus>('POST', '/ai/profile', { body: { profile } }),

  payments: (state?: string, caseId?: string) =>
    request<Payment[]>(
      'GET',
      `/payments?${new URLSearchParams({ ...(state ? { state } : {}), ...(caseId ? { caseId } : {}) })}`,
    ),
  release: (id: string, note: string) =>
    request<Payment>('POST', `/payments/${id}/release`, { body: { note } }),
  approvePayment: (id: string) => request<Payment>('POST', `/payments/${id}/approve`, { body: {} }),
  balances: () =>
    request<{
      balanced: boolean;
      entries: number;
      accounts: { account: string; balance: number }[];
    }>('GET', '/ledger/balances'),
  reconcile: () =>
    request<{
      matched: number;
      mismatched: number;
      items: { endToEndId: string; status: string }[];
    }>('POST', '/reconciliation/run', { body: {} }),

  rules: () => request<RuleVersion[]>('GET', '/rules'),
  draftRule: (def: Pick<RuleVersion, 'clauses' | 'amount'> & { notes?: string }) =>
    request<RuleVersion>('POST', '/rules/versions', { body: def }),
  simulate: (id: string) => request<Simulation>('POST', `/rules/versions/${id}/simulate`),
  publish: (id: string) => request<RuleVersion>('POST', `/rules/versions/${id}/publish`),
  costs: () =>
    request<{
      wrongApproval: number;
      humanReview: number;
      askMore: number;
      autoApproveThreshold: number;
    }>('GET', '/cost-settings'),
  setCosts: (c: { wrongApproval: number; humanReview: number; askMore: number }) =>
    request<{ autoApproveThreshold: number }>('PUT', '/cost-settings', { body: c }),

  apiKeys: () =>
    request<
      {
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
        lastUsedAt: string | null;
        revokedAt: string | null;
      }[]
    >('GET', '/api-keys'),
  createKey: (name: string, scopes: string[]) =>
    request<{ id: string; key: string }>('POST', '/api-keys', { body: { name, scopes } }),
  revokeKey: (id: string) => request<void>('DELETE', `/api-keys/${id}`),

  audit: (q: string) =>
    request<{ items: AuditEntry[]; nextCursor: number | null }>('GET', `/audit?${q}`),
  verifyChain: () =>
    request<{ valid: boolean; checked: number; brokenAtSeq?: number; reason?: string }>(
      'POST',
      '/audit/verify-chain',
      {
        body: {},
      },
    ),

  scenarios: () => request<Scenario[]>('GET', '/judge/scenarios'),
  runScenario: (id: string) => request<ScenarioResult>('POST', `/judge/scenarios/${id}/run`),
  resetDemo: () => request<{ ok: boolean }>('POST', '/judge/reset'),
  inbox: (phone: string) =>
    request<{ messageId: string; from: string; body: string; receivedAt: string }[]>(
      'GET',
      `/mock/sms/inbox/${phone}`,
    ),
  // ---------- staff visibility pages (eval, tenants, API docs, webhooks, rail faults) ----------
  evalSummary: () => request<EvalSummary>('GET', '/eval/summary'),
  evalRuns: () => request<EvalRunRow[]>('GET', '/eval/runs'),
  evalRun: (id: string) => request<EvalRun>('GET', `/eval/runs/${id}`),
  runEval: () => request<EvalRun>('POST', '/eval/run', { body: {} }),
  aiQuality: () => request<AiQuality>('GET', '/ai/status'),

  tenantMe: () => request<Tenant & { platformAdmin: boolean }>('GET', '/tenants/me'),
  tenants: () => request<Tenant[]>('GET', '/tenants'),
  tenantUsage: (id: string, days = 7) =>
    request<TenantUsage>('GET', `/tenants/${id}/usage?days=${days}`),
  launchProgram: (p: LaunchProgramInput) =>
    request<{ tenant: Tenant; admin: { id: string; name: string; phoneMasked: string } }>(
      'POST',
      '/tenants',
      { body: p },
    ),

  systemStatus: () =>
    request<{
      status: string;
      services: { name: string; ok: boolean; status: string; ms: number }[];
      docs: Record<string, string>;
    }>('GET', '/status', { auth: false }),

  webhooks: () => request<WebhookSubscription[]>('GET', '/webhooks'),
  createWebhook: (url: string) =>
    request<WebhookSubscription>('POST', '/webhooks', {
      body: { url, events: ['payments.payment.state_changed'] },
    }),
  webhookDeliveries: (id: string) =>
    request<WebhookDelivery[]>('GET', `/webhooks/${id}/deliveries`),
  resendDelivery: (id: string) =>
    request<WebhookDelivery>('POST', `/webhooks/deliveries/${id}/resend`),

  railFaults: () => request<RailFaults>('GET', '/mock/faults'),
  setRailFault: (mode: RaastFaultMode, remaining = 1) =>
    request<RailFaults>('POST', '/mock/faults', { body: { raast: { mode, remaining } } }),
  // ---------- end staff visibility pages ----------

  // ---------- officer + auditor package ----------
  staffCase: (id: string) => request<StaffCase>('GET', `/cases/${id}`),
  staffQueue: () => request<QueueCase[]>('GET', '/queue'),
  /** No officer id = "assign to me". */
  assign: (id: string, officerId?: string) =>
    request<StaffCase>('POST', `/cases/${id}/assign`, { body: { officerId } }),
  escalate: (id: string, reason: string) =>
    request<StaffCase>('POST', `/cases/${id}/escalate`, { body: { reason } }),
  closeCase: (id: string, note?: string) =>
    request<StaffCase>('POST', `/cases/${id}/close`, { body: { note } }),
  decisionTrace: (decisionId: string) =>
    request<DecisionTrace>('GET', `/decisions/${decisionId}/trace`),
  auditStats: () => request<AuditStats>('GET', '/audit/stats'),
  auditEntry: (eventId: string) => request<AuditEntry>('GET', `/audit/${eventId}`),
  paymentInquiry: (id: string) => request<Payment>('POST', `/payments/${id}/inquiry`, { body: {} }),
  paymentRetry: (id: string) => request<Payment>('POST', `/payments/${id}/retry`, { body: {} }),
};
