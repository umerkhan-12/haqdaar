'use client';

import { api } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const FIELD: Record<string, string> = {
  name: 'Name',
  cnic: 'CNIC number',
  district: 'District',
  household: 'Household or income',
};

/**
 * "My information is wrong" requests from citizens. Nothing is changed from here: the officer asks
 * the citizen through her claim ("Ask for information"), and she sends the corrected details there.
 */
export function CorrectionRequests() {
  const { data } = useAsync(() => api.correctionRequests(), []);
  if (!data?.length) return null;
  return (
    <details className="mb-3 rounded-xl border-2 border-amber-600 bg-amber-50 p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-amber-900">
        Citizens say their information is wrong ({data.length})
      </summary>
      <p className="mt-2 text-amber-900">
        Open that person’s claim and press “Ask for information”. She can then send her corrected
        name or CNIC from her phone; you approve only after checking.
      </p>
      <ul className="mt-2 space-y-1">
        {data.slice(0, 10).map((r) => (
          <li key={r.id} className="rounded-lg bg-white p-2">
            <span className="font-semibold">{FIELD[r.field] ?? r.field}</span>
            {r.note ? `: “${r.note}”` : ''}{' '}
            <span className="text-xs text-muted">
              · person {r.personId?.slice(0, 8) ?? 'unknown'} ·{' '}
              {new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
