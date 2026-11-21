import type { Family } from '../demo-data';
import type { GatewayApi } from '../gateway-api';
import { waitFor, type Run } from '../run';

export interface CaseView {
  id: string;
  status: string;
  lane: string | null;
  confidence: number | null;
  flags: string[];
  decision?: { id: string; explanationUr: string; explanationEn: string; hardFlags: string[] } | null;
  anomalies?: { type: string; evidenceCaseIds: string[]; observedCount: number; threshold: number }[];
  timeline?: { type: string }[];
}

export interface Payment {
  id: string;
  caseId: string;
  state: string;
  amount: number;
  holdReason: string | null;
  titleFetched?: string | null;
  titleMatchScore?: number | null;
  creditorName?: string;
}

export const items = <T>(b: unknown): T[] => (Array.isArray(b) ? b : ((b as { items?: T[] })?.items ?? []));

export async function grantConsents(api: GatewayApi, token: string, personId: string): Promise<void> {
  for (const purpose of ['identity_verification', 'household_data']) {
    const r = await api.call('POST', '/consents', { token, body: { personId, purpose } });
    if (r.status >= 300) throw new Error(`Consent ${purpose} failed (HTTP ${r.status})`);
  }
}

/** A family files a claim through the helper (Helper Mode), with consent given first. */
export async function claimFor(
  api: GatewayApi,
  run: Run,
  f: Family,
  o: { alias?: string; fullName?: string; key?: string } = {},
): Promise<CaseView> {
  const token = await api.family(f);
  await grantConsents(api, token, f.personId);
  const r = await run.step(
    `${f.fullName} files a claim (via helper, consent given)`,
    () =>
      api.call<CaseView>('POST', '/cases', {
        token,
        headers: { 'idempotency-key': o.key ?? api.newIdempotencyKey('judge') },
        body: {
          type: 'relief_claim',
          fullName: o.fullName ?? f.fullName,
          cnic: f.cnic,
          district: f.district,
          householdSize: f.householdSize,
          payout: { alias: o.alias ?? f.alias },
        },
      }),
    (v) => `HTTP ${v.status} → ${v.body?.status} / ${v.body?.lane} (confidence ${fmt(v.body?.confidence)})`,
  );
  if (r.status >= 300) throw new Error(`Claim failed: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

/** Automation approved it, or a human officer does (a repeat claim this month always needs a human). */
export async function ensureApproved(api: GatewayApi, run: Run, c: CaseView): Promise<void> {
  if (c.status === 'APPROVED') return;
  const officer = await api.as('officer');
  await run.step(
    'Officer reviews and approves (automation never approves repeat claims)',
    () => api.call('POST', `/cases/${c.id}/approve`, { token: officer, body: { note: 'Judge Mode' } }),
    (v) => `HTTP ${v.status}`,
  );
}

export async function paymentsForCase(api: GatewayApi, caseId: string): Promise<Payment[]> {
  const r = await api.call('GET', '/payments', { token: await api.as('officer') });
  return items<Payment>(r.body).filter((p) => p.caseId === caseId);
}

export async function waitForPayment(
  api: GatewayApi,
  caseId: string,
  states: string[],
  timeoutMs = 30_000,
): Promise<Payment> {
  return waitFor(
    async () => (await paymentsForCase(api, caseId)).find((p) => states.includes(p.state)),
    `payment in ${states.join('/')}`,
    timeoutMs,
  );
}

/** Inject a Raast fault; with `alias`, only that family's transfer is affected (no cross-talk). */
export async function setRaastFault(api: GatewayApi, mode: string, remaining = 1, alias?: string): Promise<void> {
  const r = await api.call('POST', '/mock/faults', {
    token: await api.as('admin'),
    body: { raast: { mode, remaining, ...(alias ? { alias } : {}) } },
  });
  if (r.status >= 300) throw new Error(`Could not set Raast fault (HTTP ${r.status})`);
}

export const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(3));
