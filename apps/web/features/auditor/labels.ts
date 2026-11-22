import type { AuditEntry } from '@/lib/api';
import type { Tone } from '@/components/ui';

/**
 * Readable names for audit events. The raw type stays visible in the entry detail, so nothing is
 * hidden from an auditor; unknown types fall back to the raw string.
 */
const EVENTS: Record<string, { label: string; tone: Tone }> = {
  'identity.user.logged_in': { label: 'Signed in', tone: 'neutral' },
  'identity.user.registered': { label: 'Citizen registered', tone: 'info' },
  'identity.tenant.created': { label: 'Program created', tone: 'info' },
  'identity.consent.granted': { label: 'Consent given', tone: 'ok' },
  'identity.consent.withdrawn': { label: 'Consent withdrawn', tone: 'warn' },
  'identity.correction.requested': { label: 'Correction requested', tone: 'info' },
  'cases.case.submitted': { label: 'Claim submitted', tone: 'info' },
  'cases.case.status_changed': { label: 'Case status changed', tone: 'neutral' },
  'cases.case.decided': { label: 'Claim approved', tone: 'ok' },
  'cases.rule.published': { label: 'Rule published', tone: 'warn' },
  'payments.payment.state_changed': { label: 'Payment update', tone: 'neutral' },
  'ai.call.completed': { label: 'AI call', tone: 'info' },
  'ai.kill_switch.changed': { label: 'Kill AI switch', tone: 'bad' },
  'ai.tool.called': { label: 'Assistant tool call', tone: 'info' },
  'judge.scenario.ran': { label: 'Judge scenario run', tone: 'neutral' },
  'judge.demo.reset': { label: 'Demo data reset', tone: 'warn' },
};

export const eventLabel = (type: string) => EVENTS[type]?.label ?? type;
export const eventTone = (type: string): Tone => EVENTS[type]?.tone ?? 'neutral';

/** Quick filters: each is the list of exact event types the audit API is asked for. */
export const QUICK_FILTERS = [
  { id: 'all', label: 'Everything', types: [] },
  {
    id: 'ai',
    label: 'AI actions',
    types: ['ai.call.completed', 'ai.tool.called', 'ai.kill_switch.changed'],
  },
  {
    id: 'consent',
    label: 'Consent',
    types: ['identity.consent.granted', 'identity.consent.withdrawn'],
  },
  { id: 'payments', label: 'Payments', types: ['payments.payment.state_changed'] },
  {
    id: 'decisions',
    label: 'Decisions',
    types: [
      'cases.case.decided',
      'cases.case.status_changed',
      'cases.case.submitted',
      'cases.rule.published',
    ],
  },
] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number]['id'];

const ACTIONS: Record<string, string> = {
  escalated: 'Escalated to a supervisor',
  closed: 'Case closed',
  assigned: 'Assigned to an officer',
};
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const words = (v: unknown) => text(v).replace(/_/g, ' ').toLowerCase();

/** One line saying what happened, built only from the recorded payload. */
export function eventSummary(e: AuditEntry): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'cases.case.status_changed': {
      const action = ACTIONS[text(p.action)];
      if (action) return `${action}${p.note ? `: “${text(p.note)}”` : ''}`;
      return p.from ? `${words(p.from)} → ${words(p.to)}` : `created as ${words(p.to)}`;
    }
    case 'cases.case.decided':
      return `${p.lane === 'AUTO_APPROVE' ? 'Automatically' : 'By an officer'} · confidence ${Number(p.confidence ?? 0).toFixed(3)} · Rs ${Number(p.amount ?? 0).toLocaleString('en-PK')}`;
    case 'cases.case.submitted': {
      const flags = (p.aiNotes as { softFlags?: string[] } | undefined)?.softFlags ?? [];
      return `${words(p.type)}${p.aiNotes ? ` · AI notes attached${flags.length ? ` (${flags.length} caution${flags.length > 1 ? 's' : ''})` : ''}` : ''}`;
    }
    case 'cases.rule.published':
      return `Rule v${text(p.version)} is now live`;
    case 'payments.payment.state_changed':
      return `${p.from ? `${words(p.from)} → ` : ''}${words(p.to)} · Rs ${Number(p.amount ?? 0).toLocaleString('en-PK')}${p.reason ? ` · ${words(p.reason)}` : ''}`;
    case 'ai.call.completed':
      return `${text(p.task)} · ${text(p.provider)} / ${text(p.model)} · ${text(p.latencyMs)} ms · ${p.ok ? 'ok' : 'failed'}${p.fallbackUsed ? ' · fallback used' : ''}`;
    case 'ai.tool.called':
      return `${text(p.tool)} · read-only · ${text(p.ms)} ms · ${p.ok ? 'ok' : 'failed'} · chosen by ${text(p.planner)}`;
    case 'ai.kill_switch.changed':
      return p.killed ? 'AI switched OFF: every case goes to a human' : 'AI switched back on';
    case 'identity.consent.granted':
    case 'identity.consent.withdrawn':
      return `for ${words(p.purpose)}`;
    case 'judge.scenario.ran':
      return `${text(p.scenarioId)} · ${p.ok ? 'passed' : 'failed'} · ${text(p.durationMs)} ms`;
    default:
      return '';
  }
}

/** Group the last-24h counts from `/audit/stats` into the same buckets as the quick filters. */
export function statBuckets(last24h: Record<string, number>): { label: string; count: number }[] {
  const sum = (types: readonly string[]) => types.reduce((n, t) => n + (last24h[t] ?? 0), 0);
  return QUICK_FILTERS.filter((f) => f.id !== 'all').map((f) => ({
    label: f.label,
    count: sum(f.types),
  }));
}

/** "Zainab Bibi" → "Z••••• B•••": an audit view shows that a name was used, not the name. */
export const maskName = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]}${'•'.repeat(Math.max(1, w.length - 1))}`)
    .join(' ');

/** JSON for the "raw" disclosure with names masked the same way. */
export function maskedJson(value: unknown): string {
  return JSON.stringify(
    value,
    (key, v) => (key === 'fullName' && typeof v === 'string' ? maskName(v) : v),
    2,
  );
}
