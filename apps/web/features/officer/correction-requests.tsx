'use client';

import { useMemo, useState } from 'react';
import { Button, ConfirmDialog, StatusPill, staffError } from '@/components/ui';
import { api, type CorrectionContext } from '@/lib/api';
import { useAsync } from '@/lib/hooks';
import { statusLabel } from './labels';

const FIELD: Record<string, string> = {
  name: 'Name',
  cnic: 'CNIC number',
  district: 'District',
  household: 'Household size',
};

/** What she is asked to send when the wrong fact is one only she can prove. */
const ASK: Record<string, string> = {
  name: 'Please send your correct full name, exactly as it is written on your CNIC card.',
  cnic: 'Please send your correct 13-digit CNIC number, exactly as it is printed on your card.',
};

type Request = {
  id: string;
  at: string;
  personId: string | null;
  field: string;
  note: string | null;
};
type Person = CorrectionContext['people'][number];
type Open = { request: Request; person: Person; kind: 'apply' | 'ask' };

const reviewable = (p?: Person) => p?.status === 'IN_REVIEW' || p?.status === 'NEEDS_INFO';

/**
 * "My information is wrong" requests from citizens. District and household are corrected here after
 * checking; a wrong name or CNIC is asked back from her, because only her card proves it. A request
 * counts as handled once her claim's timeline shows the correction or the request for information.
 */
export function CorrectionRequests({
  onOpen,
  onChanged,
}: {
  onOpen: (caseId: string) => void;
  onChanged: () => void;
}) {
  const list = useAsync(() => api.correctionRequests(), []);
  const personIds = useMemo(
    () => [...new Set((list.data ?? []).map((r) => r.personId).filter((p): p is string => !!p))],
    [list.data],
  );
  const ctx = useAsync(
    () =>
      personIds.length
        ? api.correctionContext(personIds)
        : Promise.resolve<CorrectionContext>({ people: [], handled: [] }),
    [personIds.join(',')],
  );
  const [open, setOpen] = useState<Open | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const people = new Map((ctx.data?.people ?? []).map((p) => [p.personId, p]));
  const handled = new Set(ctx.data?.handled ?? []);
  const rows = list.data ?? [];
  const waiting = rows.filter((r) => !handled.has(r.id));

  if (list.error)
    return (
      <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">
        Could not load what citizens say is wrong: {staffError(list.error)}
      </p>
    );
  if (!rows.length) return null;

  function start(request: Request, person: Person, kind: Open['kind']) {
    setMessage(null);
    setValue(
      kind === 'ask'
        ? (ASK[request.field] ?? '')
        : request.field === 'district'
          ? ''
          : String(person.householdSize ?? ''),
    );
    setOpen({ request, person, kind });
  }

  const size = Number(value);
  const valid =
    open?.kind === 'ask'
      ? value.trim().length >= 5
      : open?.request.field === 'district'
        ? value.trim().length >= 2
        : Number.isInteger(size) && size >= 1 && size <= 30;

  async function confirm() {
    if (!open || !valid) return;
    const { request, person, kind } = open;
    setBusy(true);
    try {
      if (kind === 'ask') await api.requestInfo(person.caseId, value.trim(), request.id);
      else
        await api.applyCorrection(
          person.caseId,
          request.field === 'district'
            ? { field: 'district', district: value.trim(), correctionId: request.id }
            : { field: 'household', householdSize: size, correctionId: request.id },
        );
      setMessage(
        kind === 'ask'
          ? 'Asked her to send it. Her claim now waits for her answer.'
          : `${FIELD[request.field]} corrected on her record and her claim.`,
      );
    } catch (e) {
      setMessage(staffError(e));
    } finally {
      setBusy(false);
      setOpen(null);
      ctx.reload();
      onChanged();
    }
  }

  return (
    <details className="mb-3 rounded-xl border-2 border-amber-600 bg-amber-50 p-3 text-sm" open>
      <summary className="cursor-pointer font-semibold text-amber-900">
        Citizens say their information is wrong ({waiting.length} waiting)
      </summary>
      <p className="mt-2 text-amber-900">
        Check the claim first. A district or household size can be corrected here; a name or CNIC is
        asked back from her, because only her card proves it.
      </p>
      {ctx.error !== undefined && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-red-900">
          Could not find their claims: {staffError(ctx.error)}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 rounded-lg bg-white p-2">
          {message}
        </p>
      )}
      <ul className="mt-2 space-y-2">
        {[...waiting, ...rows.filter((r) => handled.has(r.id))].slice(0, 20).map((r) => {
          const person = r.personId ? people.get(r.personId) : undefined;
          const done = handled.has(r.id);
          const canFix = r.field === 'district' || r.field === 'household';
          return (
            <li key={r.id} className={`rounded-lg bg-white p-2 ${done ? 'opacity-70' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{FIELD[r.field] ?? r.field}</span>
                {done && <StatusPill tone="ok">Handled</StatusPill>}
                <span className="ml-auto text-xs text-muted">
                  {new Date(r.at).toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              {r.note && <p className="mt-1">“{r.note}”</p>}
              <p className="mt-1 text-xs text-muted">
                {person
                  ? `${person.name ?? 'Name hidden (consent withdrawn)'} · latest claim ${statusLabel(person.status)}${person.district ? ` · ${person.district}` : ''}`
                  : ctx.loading
                    ? 'Finding her claim…'
                    : 'No claim found for this person.'}
              </p>
              {person && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    className="min-h-10 text-sm"
                    onClick={() => onOpen(person.caseId)}
                  >
                    Open claim
                  </Button>
                  {!done && reviewable(person) && (
                    <Button
                      className="min-h-10 text-sm"
                      disabled={busy}
                      onClick={() => start(r, person, canFix ? 'apply' : 'ask')}
                    >
                      {canFix ? 'Apply change…' : 'Ask her to send it…'}
                    </Button>
                  )}
                </div>
              )}
              {person && !done && !reviewable(person) && (
                <p className="mt-1 text-xs text-muted">
                  Her latest claim is {statusLabel(person.status).toLowerCase()}; only a claim
                  waiting for review can be changed.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!open}
        title={
          open?.kind === 'ask'
            ? `Ask her to send her ${FIELD[open.request.field]?.toLowerCase()}`
            : `Correct the ${FIELD[open?.request.field ?? '']?.toLowerCase() ?? 'record'}`
        }
        confirmLabel={open?.kind === 'ask' ? 'Send request' : 'Apply change'}
        busy={busy || !valid}
        onClose={() => setOpen(null)}
        onConfirm={() => void confirm()}
      >
        {open?.request.note && (
          <p className="rounded-xl bg-amber-50 p-2 text-sm">She said: “{open.request.note}”</p>
        )}
        {open?.kind === 'ask' ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Message she will hear</span>
            <textarea
              maxLength={500}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              className="w-full rounded-xl border-2 border-slate-400 p-2"
            />
          </label>
        ) : open?.request.field === 'district' ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Correct district (now {open.person.district ?? 'not recorded'})
            </span>
            <input
              value={value}
              maxLength={60}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-xl border-2 border-slate-400 p-2"
            />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Correct household size (now {open?.person.householdSize ?? 'not recorded'})
            </span>
            <input
              value={value}
              inputMode="numeric"
              onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 2))}
              className="w-full rounded-xl border-2 border-slate-400 p-2"
            />
          </label>
        )}
        {!valid && (
          <p className="text-xs text-muted">
            {open?.kind === 'ask'
              ? 'At least 5 characters.'
              : open?.request.field === 'district'
                ? 'At least 2 letters.'
                : 'A number from 1 to 30.'}
          </p>
        )}
        {open?.kind === 'apply' && (
          <p className="text-xs text-muted">
            The change is recorded on her claim’s timeline. Approve only after checking it.
          </p>
        )}
      </ConfirmDialog>
    </details>
  );
}
