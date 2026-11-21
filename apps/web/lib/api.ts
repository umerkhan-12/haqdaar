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

export async function request<T>(method: string, path: string, o: Options = {}, retried = false): Promise<T> {
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

export const items = <T>(b: unknown): T[] => (Array.isArray(b) ? (b as T[]) : ((b as { items?: T[] })?.items ?? []));

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
  clauses: { id: string; passed?: boolean; ok?: boolean; textUr?: string; textEn?: string }[] | Record<string, boolean>;
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
  extraction?: unknown;
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

// ---------- endpoints ----------
export const api = {
  login: (phone: string, password: string) =>
    request<Tokens>('POST', '/auth/login', { body: { phone, password }, auth: false }),
  logout: (refreshToken: string) => request<void>('POST', '/auth/logout', { body: { refreshToken }, auth: false }),
  families: (token?: string) =>
    request<{ personId: string; label: string; locked: boolean }[]>('GET', '/auth/families', { token }),
  actFor: (personId: string, pin: string, token?: string) =>
    request<Tokens>('POST', '/auth/act-for', { body: { personId, pin }, token }),

  consents: () => request<{ id: string; purpose: string; status: string }[]>('GET', '/consents'),
  grantConsent: (personId: string, purpose: string) => request('POST', '/consents', { body: { personId, purpose } }),
  withdrawConsent: (id: string) => request('POST', `/consents/${id}/withdraw`),

  submitClaim: (claim: ClaimInput, idempotencyKey: string) =>
    request<CaseDetail>('POST', '/cases', { body: claim, headers: { 'idempotency-key': idempotencyKey } }),
  resubmit: (id: string) => request<CaseDetail>('POST', `/cases/${id}/resubmit`),
  cases: () => request<CaseSummary[]>('GET', '/cases'),
  case: (id: string) => request<CaseDetail>('GET', `/cases/${id}`),
  queue: () => request<CaseSummary[]>('GET', '/queue'),
  approve: (id: string, note?: string) => request('POST', `/cases/${id}/approve`, { body: { note } }),
  reject: (id: string, reason: string) => request('POST', `/cases/${id}/reject`, { body: { reason } }),
  requestInfo: (id: string, message: string) => request('POST', `/cases/${id}/request-info`, { body: { message } }),
  trace: (decisionId: string) => request<{ decision: unknown; ruleVersion: unknown }>('GET', `/decisions/${decisionId}/trace`),

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
  extract: (transcript: string) => request<Extraction>('POST', '/ai/extract-claim', { body: { transcript } }),
  scamCheck: (text: string) => request<ScamVerdict>('POST', '/ai/scam-check', { body: { text } }),
  aiStatus: () => request<AiStatus>('GET', '/ai/status'),
  setKill: (killed: boolean) => request<AiStatus>('POST', '/ai/kill-switch', { body: { killed } }),
  setProfile: (profile: AiStatus['profile']) => request<AiStatus>('POST', '/ai/profile', { body: { profile } }),

  payments: (state?: string) => request<Payment[]>('GET', `/payments${state ? `?state=${state}` : ''}`),
  release: (id: string, note: string) => request<Payment>('POST', `/payments/${id}/release`, { body: { note } }),
  approvePayment: (id: string) => request<Payment>('POST', `/payments/${id}/approve`, { body: {} }),
  balances: () =>
    request<{ balanced: boolean; entries: number; accounts: { account: string; balance: number }[] }>('GET', '/ledger/balances'),
  reconcile: () =>
    request<{ matched: number; mismatched: number; items: { endToEndId: string; status: string }[] }>(
      'POST',
      '/reconciliation/run',
      { body: {} },
    ),

  rules: () => request<RuleVersion[]>('GET', '/rules'),
  draftRule: (def: Pick<RuleVersion, 'clauses' | 'amount'> & { notes?: string }) =>
    request<RuleVersion>('POST', '/rules/versions', { body: def }),
  simulate: (id: string) => request<Simulation>('POST', `/rules/versions/${id}/simulate`),
  publish: (id: string) => request<RuleVersion>('POST', `/rules/versions/${id}/publish`),
  costs: () =>
    request<{ wrongApproval: number; humanReview: number; askMore: number; autoApproveThreshold: number }>(
      'GET',
      '/cost-settings',
    ),
  setCosts: (c: { wrongApproval: number; humanReview: number; askMore: number }) =>
    request<{ autoApproveThreshold: number }>('PUT', '/cost-settings', { body: c }),

  apiKeys: () =>
    request<{ id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null }[]>(
      'GET',
      '/api-keys',
    ),
  createKey: (name: string, scopes: string[]) =>
    request<{ id: string; key: string }>('POST', '/api-keys', { body: { name, scopes } }),
  revokeKey: (id: string) => request<void>('DELETE', `/api-keys/${id}`),

  audit: (q: string) => request<{ items: AuditEntry[]; nextCursor: number | null }>('GET', `/audit?${q}`),
  verifyChain: () =>
    request<{ valid: boolean; checked: number; brokenAtSeq?: number; reason?: string }>('POST', '/audit/verify-chain', {
      body: {},
    }),

  scenarios: () => request<Scenario[]>('GET', '/judge/scenarios'),
  runScenario: (id: string) => request<ScenarioResult>('POST', `/judge/scenarios/${id}/run`),
  resetDemo: () => request<{ ok: boolean }>('POST', '/judge/reset'),
  inbox: (phone: string) =>
    request<{ messageId: string; from: string; body: string; receivedAt: string }[]>('GET', `/mock/sms/inbox/${phone}`),
};
