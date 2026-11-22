'use client';

import { useState } from 'react';
import { Button, Card, StatusPill, staffError } from '@/components/ui';
import { api, type Anomaly, type AnomalyScan } from '@/lib/api';
import { anomalyEvidence, flagLabel } from './labels';

const shortId = (id: string) => id.slice(0, 8);

/**
 * Fraud-ring signals on one case, in plain English with the evidence behind each.
 * Staff only: the citizen's own view and her explanation never mention these checks,
 * so a fraudster cannot learn which one fired.
 */
export function FraudSignalsCard({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) return null;
  return (
    <Card className="border-amber-700 bg-amber-50">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Fraud-ring signals</h3>
        <StatusPill tone="warn">Staff only — not shown to the citizen</StatusPill>
      </div>
      <ul className="mt-2 space-y-3 text-sm">
        {anomalies.map((a) => {
          const { label, meaning } = flagLabel(`anomaly:${a.type}`);
          return (
            <li key={`${a.type}-${a.windowStart}`}>
              <p className="font-semibold">{label}</p>
              <p>{meaning}</p>
              <p className="mt-1">{anomalyEvidence(a)}</p>
              <p className="mt-1 text-muted">
                Linked cases ({a.evidenceCaseIds.length}):{' '}
                <span className="font-mono">{a.evidenceCaseIds.map(shortId).join(', ')}</span>
                {' · '}seen between {new Date(a.windowStart).toLocaleDateString('en-PK')} and{' '}
                {new Date(a.windowEnd).toLocaleDateString('en-PK')}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-muted">
        A signal is a reason to look, not proof. It only sends the claim to an officer; it never
        rejects anyone.
      </p>
    </Card>
  );
}

/** "Scan for fraud rings": runs the program-wide scan and says what it found. */
export function FraudScan({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnomalyScan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.anomalyScan());
      onDone();
    } catch (e) {
      setError(staffError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3">
      <Button variant="ghost" className="w-full text-base" disabled={busy} onClick={scan}>
        {busy ? 'Scanning…' : 'Scan for fraud rings'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="mt-2 rounded-xl bg-slate-100 p-3 text-sm">
          <p className="font-semibold">
            Checked {result.scannedCases} claims: {result.signalsDetected} signal
            {result.signalsDetected === 1 ? '' : 's'} found ({result.findingsCreated} new,{' '}
            {result.findingsUpdated} already known).
          </p>
          {result.findings.length > 0 && (
            <ul className="mt-1 list-disc ps-5">
              {result.findings.map((f) => (
                <li key={`${f.type}-${f.evidenceCaseIds.join()}`}>
                  {flagLabel(`anomaly:${f.type}`).label}: {anomalyEvidence(f)}{' '}
                  {f.evidenceCaseIds.length} linked cases.
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-muted">
            Open claims with a signal are in the queue for a person to review. Nothing was rejected
            or paid by this scan.
          </p>
        </div>
      )}
    </div>
  );
}
