'use client';

import type { ReactNode } from 'react';
import { Card, StatusPill } from '@/components/ui';
import type { AuditEntry, DecisionTrace, StaffCase } from '@/lib/api';
import { flagLabel, laneLabel } from '../officer/labels';
import { maskName, maskedJson } from './labels';

/** Everything needed to explain one case's decisions to an auditor. */
export interface CaseTrace {
  caseView: StaffCase;
  traces: DecisionTrace[];
  /** `ai.call.completed` audit entries by the submitter in the minutes before the claim. */
  aiCalls: AuditEntry[];
}

interface EngineInputs {
  facts?: {
    claim?: {
      fullName?: string;
      district?: string | null;
      householdSize?: number | null;
      isWidow?: boolean | null;
    };
    nadra?: {
      match?: boolean;
      nameScore?: number;
      deceased?: boolean;
      maritalStatus?: string;
      gender?: string;
      district?: string;
    } | null;
    household?: {
      householdSize?: number;
      monthlyIncomePkr?: number;
      district?: string;
      pmtScore?: number;
    } | null;
  };
  evidence?: {
    nadraMatch?: boolean;
    nameScore?: number;
    householdVerified?: boolean;
    extractionConfidence?: number | null;
    possibleDuplicate?: boolean;
  };
  missing?: string[];
  softFlags?: string[];
  humanDecision?: string;
}

const yesNo = (v: boolean | null | undefined) =>
  v === null || v === undefined ? '—' : v ? 'yes' : 'no';
const show = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : String(v);

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[11rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Inputs({ inputs }: { inputs: EngineInputs }) {
  const { claim, nadra, household } = inputs.facts ?? {};
  const ev = inputs.evidence;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div>
        <h4 className="text-sm font-semibold">Claim (as stated)</h4>
        <Rows
          rows={[
            ['Name', claim?.fullName ? maskName(claim.fullName) : '—'],
            ['District', show(claim?.district)],
            ['Household size', show(claim?.householdSize)],
            ['Says widow', yesNo(claim?.isWidow)],
          ]}
        />
      </div>
      <div>
        <h4 className="text-sm font-semibold">Identity record</h4>
        {nadra ? (
          <Rows
            rows={[
              ['CNIC found', yesNo(nadra.match)],
              ['Name match', nadra.nameScore === undefined ? '—' : nadra.nameScore.toFixed(2)],
              ['Deceased', yesNo(nadra.deceased)],
              ['Marital status', show(nadra.maritalStatus)],
              ['District', show(nadra.district)],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">Not consulted (no consent, or the service was down).</p>
        )}
      </div>
      <div>
        <h4 className="text-sm font-semibold">Household record</h4>
        {household ? (
          <Rows
            rows={[
              ['Members', show(household.householdSize)],
              [
                'Monthly income',
                household.monthlyIncomePkr === undefined
                  ? '—'
                  : `Rs ${household.monthlyIncomePkr.toLocaleString('en-PK')}`,
              ],
              ['District', show(household.district)],
              ['Poverty score', show(household.pmtScore)],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">No household record was used.</p>
        )}
      </div>
      {ev && (
        <div className="md:col-span-3">
          <h4 className="text-sm font-semibold">Evidence behind the confidence score</h4>
          <p className="text-sm">
            identity matched: {yesNo(ev.nadraMatch)} · name match {ev.nameScore?.toFixed(2) ?? '—'}{' '}
            · household verified: {yesNo(ev.householdVerified)} · voice-reading confidence:{' '}
            {ev.extractionConfidence === null || ev.extractionConfidence === undefined
              ? 'typed claim'
              : ev.extractionConfidence.toFixed(2)}{' '}
            · similar name under another CNIC: {yesNo(ev.possibleDuplicate)}
          </p>
        </div>
      )}
      {inputs.missing && inputs.missing.length > 0 && (
        <p className="text-sm md:col-span-3">
          <span className="font-semibold">Missing when decided:</span>{' '}
          {inputs.missing
            .map((m) => m.replace(/^consent:/, 'consent for ').replace(/_/g, ' '))
            .join(', ')}
        </p>
      )}
    </div>
  );
}

function DecisionBlock({
  t,
  index,
  fallbackThreshold,
}: {
  t: DecisionTrace;
  index: number;
  fallbackThreshold: number | null;
}) {
  const d = t.decision;
  const inputs = (d.inputs ?? {}) as EngineInputs;
  const bySystem = d.decidedBy === 'system';
  const threshold = d.threshold ?? fallbackThreshold;
  const texts = new Map((t.ruleVersion?.clauses ?? []).map((c) => [c.id, c.textEn]));
  const clauses = Array.isArray(d.clausesHit) ? d.clausesHit : [];

  return (
    <section
      className="rounded-xl border border-slate-200 p-3"
      aria-label={`Decision ${index + 1}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          {index + 1}.{' '}
          {bySystem
            ? 'Automatic decision'
            : `Officer decision: ${String(inputs.humanDecision ?? '').toLowerCase() || 'recorded'}`}
        </h3>
        <StatusPill tone={bySystem ? 'info' : 'neutral'}>
          {bySystem ? laneLabel(d.lane) : 'human'}
        </StatusPill>
        <time className="ml-auto text-sm text-muted" dateTime={d.createdAt}>
          {new Date(d.createdAt).toLocaleString('en-PK')}
        </time>
      </div>

      <Rows
        rows={[
          ['Decided by', bySystem ? 'system (rules engine)' : `officer ${d.decidedBy.slice(0, 8)}`],
          [
            'Rule version',
            t.ruleVersion
              ? `v${t.ruleVersion.version} (${t.ruleVersion.status.toLowerCase()}), pays Rs ${t.ruleVersion.amount.toLocaleString('en-PK')}`
              : '—',
          ],
          [
            'Confidence vs threshold',
            <span key="c">
              {d.confidence.toFixed(3)} vs {threshold === null ? '—' : threshold.toFixed(3)}{' '}
              {threshold !== null && (
                <StatusPill tone={d.confidence >= threshold ? 'ok' : 'warn'}>
                  {d.confidence >= threshold ? 'at or above' : 'below'}
                </StatusPill>
              )}
              {d.threshold === null && threshold !== null && (
                <span className="ml-1 text-xs text-muted">
                  (today’s threshold; not stored on this older decision)
                </span>
              )}
            </span>,
          ],
          ['Eligible by the rule', yesNo(d.eligible)],
          ['Explanation', d.explanationEn],
        ]}
      />

      {clauses.length > 0 && (
        <>
          <h4 className="mt-3 text-sm font-semibold">Rule clauses</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {clauses.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <StatusPill tone={c.passed ? 'ok' : 'bad'}>{c.passed ? 'pass' : 'fail'}</StatusPill>
                <span>
                  {texts.get(c.id) ?? c.id.replace(/_/g, ' ')}{' '}
                  <span className="font-mono text-xs text-muted">({c.id})</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="mt-3 text-sm font-semibold">Flags</h4>
      {d.hardFlags.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {d.hardFlags.map((f) => (
            <li key={f} className="flex flex-wrap items-baseline gap-2">
              <StatusPill tone="warn">{flagLabel(f).label}</StatusPill>
              <span>{flagLabel(f).meaning}</span>
              {inputs.softFlags?.includes(f) && (
                <span className="text-xs text-muted">(from AI notes)</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {bySystem && (
        <>
          <h4 className="mt-3 text-sm font-semibold">What the engine saw (name masked)</h4>
          <Inputs inputs={inputs} />
        </>
      )}
    </section>
  );
}

/** A decision trace an auditor can read top to bottom, with the raw record one click away. */
export function TraceView({ trace, onClose }: { trace: CaseTrace; onClose: () => void }) {
  const { caseView: c, traces, aiCalls } = trace;
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Decision trace</h2>
        <span className="font-mono text-xs text-muted">case {c.id.slice(0, 8)}</span>
        <StatusPill>{c.status.replace(/_/g, ' ').toLowerCase()}</StatusPill>
        {c.escalated && <StatusPill tone="bad">Escalated</StatusPill>}
        <button className="ml-auto min-h-12 px-2 text-sm underline" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="text-sm text-muted">
        CNIC {c.person.cnicMasked} · {c.person.district ?? 'district unknown'} · {traces.length}{' '}
        decision{traces.length === 1 ? '' : 's'} recorded, oldest first
      </p>

      <div className="mt-3 space-y-3">
        {traces.map((t, i) => (
          <DecisionBlock
            key={t.decision.id}
            t={t}
            index={i}
            fallbackThreshold={c.decision?.threshold ?? null}
          />
        ))}
      </div>

      <h3 className="mt-4 font-semibold">AI calls before this claim</h3>
      {aiCalls.length === 0 ? (
        <p className="text-sm text-muted">
          No AI call by the submitter was recorded in the 30 minutes before the claim (typed claim,
          or AI was off).
        </p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {aiCalls.map((e) => {
            const p = (e.payload ?? {}) as {
              task?: string;
              provider?: string;
              model?: string;
              latencyMs?: number;
              ok?: boolean;
              fallbackUsed?: boolean;
            };
            return (
              <li key={e.eventId} className="flex flex-wrap items-center gap-2">
                <StatusPill tone={p.ok ? 'ok' : 'bad'}>{p.ok ? 'ok' : 'failed'}</StatusPill>
                <span>
                  {p.task} · {p.provider} / {p.model} · {p.latencyMs} ms
                  {p.fallbackUsed ? ' · fallback used' : ''}
                </span>
                <time className="text-xs text-muted" dateTime={e.occurredAt}>
                  {new Date(e.occurredAt).toLocaleTimeString('en-PK')}
                </time>
                <span className="font-mono text-xs text-muted">#{e.seq}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">
        AI only reads speech and photos into a draft. The decision above is made by the rules engine
        or an officer, never by the AI.
      </p>

      <details className="mt-4">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium text-brand underline">
          Raw JSON (names masked)
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {maskedJson({ decisions: traces, aiCalls })}
        </pre>
      </details>
    </Card>
  );
}
