'use client';

import { Card, StatusPill, type Tone } from '@/components/ui';
import type { AiNotes } from '@/lib/api';
import { checkLabel, flagLabel, missingLabel, reasonLabel } from './labels';

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

function Match({ same }: { same: boolean | null }) {
  if (same === null) return <span className="text-muted">not read</span>;
  return (
    <StatusPill tone={same ? 'ok' : 'bad'}>
      {same ? 'same as claim' : 'differs from claim'}
    </StatusPill>
  );
}

/** Scores are 0..1 where higher is worse; three bands are enough for a decision. */
function scoreTone(n: number | null): Tone {
  return n === null ? 'neutral' : n >= 0.5 ? 'bad' : n >= 0.25 ? 'warn' : 'ok';
}

/**
 * The hand-over from AI to human: what the AI heard, what it took from it, why it was unsure and
 * what the card photo showed. These notes were sent by the citizen's device, so they only ever add
 * caution: they never raised the confidence of this case.
 */
export function AiNotesCard({
  notes,
  typedCnicMasked,
  flags,
}: {
  notes: AiNotes;
  typedCnicMasked: string;
  flags: string[];
}) {
  const ex = notes.extraction;
  const doc = notes.documentCheck;
  const failed = doc?.checks.filter((c) => !c.ok) ?? [];

  return (
    <Card>
      <h3 className="font-semibold">AI notes</h3>
      <p className="text-xs text-muted">
        Reported by the citizen’s device. They can send a case to you, never approve it.
      </p>

      {flags.length > 0 && (
        <section aria-label="Flags" className="mt-3">
          <h4 className="text-sm font-semibold">Why this case needs care</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {flags.map((f) => {
              const { label, meaning } = flagLabel(f);
              return (
                <li key={f} className="flex flex-wrap items-baseline gap-2">
                  <StatusPill tone="warn">{label}</StatusPill>
                  <span>{meaning}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Speech" className="mt-4">
        <h4 className="text-sm font-semibold">What the AI heard</h4>
        {!ex ? (
          <p className="mt-1 text-sm text-muted">
            No voice notes: this claim was typed, or the AI was not used.
          </p>
        ) : (
          <>
            <blockquote className="mt-1 rounded-lg bg-slate-50 p-2 text-sm" dir="auto">
              {ex.transcript ?? 'No transcript was kept.'}
            </blockquote>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <StatusPill tone={ex.needsHuman ? 'warn' : 'ok'}>
                {ex.needsHuman ? 'AI said: I am not sure' : 'AI was confident'}
              </StatusPill>
              <span>
                AI confidence {pct(ex.confidence)}
                {ex.reason ? ` — unsure because ${reasonLabel(ex.reason)}` : ''}
              </span>
            </p>
            <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Name heard</dt>
              <dd>{ex.fullName ?? '—'}</dd>
              <dt className="text-muted">CNIC heard</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{ex.cnicMasked ?? '—'}</span>
                {ex.cnicMasked && <Match same={ex.cnicMatchesClaim} />}
              </dd>
              <dt className="text-muted">Phone heard</dt>
              <dd className="font-mono">{ex.phoneMasked ?? '—'}</dd>
              <dt className="text-muted">District</dt>
              <dd>{ex.district ?? '—'}</dd>
              <dt className="text-muted">Household</dt>
              <dd>
                {ex.householdSize ?? '—'}
                {ex.isWidow === null
                  ? ''
                  : ex.isWidow
                    ? ' · says she is a widow'
                    : ' · did not say widow'}
              </dd>
              {ex.missingFields.length > 0 && (
                <>
                  <dt className="text-muted">Not found in speech</dt>
                  <dd>{ex.missingFields.map(missingLabel).join(', ')}</dd>
                </>
              )}
            </dl>
          </>
        )}
      </section>

      <section aria-label="Document check" className="mt-4">
        <h4 className="text-sm font-semibold">CNIC photo check</h4>
        {!doc ? (
          <p className="mt-1 text-sm text-muted">
            {notes.documentStatus === 'skipped'
              ? 'She skipped the card photo. Identity was still checked against the identity record.'
              : 'No card photo came with this claim.'}
          </p>
        ) : (
          <>
            <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">On the claim</dt>
              <dd className="font-mono">{typedCnicMasked}</dd>
              <dt className="text-muted">Printed on card</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{doc.cnicFromOcrMasked ?? '—'}</span>
                <Match same={doc.ocrMatchesClaim} />
              </dd>
              <dt className="text-muted">Inside QR code</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{doc.cnicFromQrMasked ?? '—'}</span>
                <Match same={doc.qrMatchesClaim} />
              </dd>
              <dt className="text-muted">Edit suspicion</dt>
              <dd>
                <StatusPill tone={scoreTone(doc.forgeryScore)}>{pct(doc.forgeryScore)}</StatusPill>
                <span className="ml-2 text-muted">0% = looks untouched</span>
              </dd>
              <dt className="text-muted">Blur</dt>
              <dd>
                <StatusPill tone={scoreTone(doc.blurScore)}>{pct(doc.blurScore)}</StatusPill>
                <span className="ml-2 text-muted">50% or more = retake</span>
              </dd>
            </dl>
            {failed.length === 0 ? (
              <p className="mt-2 text-sm">
                <StatusPill tone="ok">All {doc.checks.length} checks passed</StatusPill>
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {failed.map((c) => {
                  const { label, failure } = checkLabel(c.id);
                  return (
                    <li key={c.id}>
                      <StatusPill tone="bad">Failed: {label}</StatusPill> <span>{failure}</span>
                      {c.detail && (
                        <span className="block pl-1 text-xs text-muted">{c.detail}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
