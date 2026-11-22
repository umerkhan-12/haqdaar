'use client';

import { useEffect, useState } from 'react';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  DataTable,
  Skeleton,
  StatusPill,
  staffError,
  type Tone,
} from '@/components/ui';
import { api, type ScamMap } from '@/lib/api';
import { useAsync, useSession } from '@/lib/hooks';

/** What each red flag means, in the words an officer would use. */
const FLAG: Record<string, string> = {
  asks_secret: 'Asks for a PIN, OTP or password',
  pay_to_receive: 'Asks for a fee before paying',
  link: 'Contains a link',
  prize: 'Promises a prize or lottery',
  urgency: 'Pressures to act at once',
  call_number: 'Says to call a private number',
  forged_seal: 'Forged or copied Haqdaar Seal',
};
const flagLabel = (id: string) => FLAG[id] ?? id.replace(/_/g, ' ');
const verdictTone = (v: string): Tone => (v === 'SCAM' ? 'bad' : v === 'UNSURE' ? 'warn' : 'ok');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Card>
  );
}

/** A row of bars sharing one scale; the scam part of each bar is drawn in red. */
function Bars({ rows }: { rows: { label: string; total: number; scam: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div
      className="flex h-28 items-end gap-1"
      role="img"
      aria-label="Checks over time; red is scams"
    >
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex flex-1 flex-col items-center gap-1"
          title={`${r.label}: ${r.total} checked, ${r.scam} scams`}
        >
          <div className="flex w-full flex-1 flex-col justify-end">
            <div
              className="w-full rounded-t bg-slate-300"
              style={{ height: `${((r.total - r.scam) / max) * 100}%` }}
            />
            <div className="w-full bg-red-600" style={{ height: `${(r.scam / max) * 100}%` }} />
          </div>
          <span className="text-[10px] text-muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** District × scam type. Darker cells mean more scam messages of that kind from that district. */
function Grid({ map }: { map: ScamMap }) {
  const districts = [...new Set(map.grid.map((g) => g.district))];
  const flags = [...new Set(map.grid.map((g) => g.flag))];
  const max = Math.max(1, ...map.grid.map((g) => g.count));
  if (!map.grid.length)
    return <p className="text-muted">No scam messages with a known district yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <caption className="sr-only">Scam messages by district and type</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left text-xs text-muted">
              District
            </th>
            {flags.map((f) => (
              <th key={f} scope="col" className="text-xs font-medium text-muted">
                {flagLabel(f)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {districts.map((d) => (
            <tr key={d}>
              <th scope="row" className="whitespace-nowrap pr-2 text-left font-medium">
                {d}
              </th>
              {flags.map((f) => {
                const n = map.grid.find((g) => g.district === d && g.flag === f)?.count ?? 0;
                return (
                  <td
                    key={f}
                    className={`h-10 min-w-16 rounded text-center font-semibold ${n / max > 0.5 ? 'text-white' : 'text-ink'}`}
                    style={{
                      backgroundColor: n
                        ? `rgba(185, 28, 28, ${0.15 + 0.85 * (n / max)})`
                        : '#f1f5f9',
                    }}
                  >
                    {n || ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live view of scam patterns by type, district and time, built only from classified messages. */
export function ScamMapPage() {
  const session = useSession();
  const { data: map, error, loading, reload } = useAsync(() => api.scamMap(7));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // The map is live: new checks appear without a reload.
  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);

  async function loadSamples() {
    setBusy('samples');
    setMsg(null);
    try {
      const samples = await api.scamSamples();
      let done = 0;
      for (const s of samples) {
        await api.scamCheck(s.text, s.district).then(
          () => done++,
          () => undefined,
        );
      }
      setMsg(`${done} of ${samples.length} sample messages were checked by the real scam check.`);
      reload();
    } catch (e) {
      setMsg(staffError(e));
    } finally {
      setBusy('');
    }
  }

  async function resolve(id: string, label: 'confirmed_scam' | 'genuine') {
    setBusy(id);
    try {
      await api.resolveScamReport(id, label);
      reload();
    } catch (e) {
      setMsg(staffError(e));
    } finally {
      setBusy('');
    }
  }

  const canLabel = session?.role === 'officer' || session?.role === 'admin';

  return (
    <Shell roles={['admin', 'officer', 'auditor']} wide>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Scam Map</h1>
        {session?.role === 'admin' && (
          <Button variant="ghost" onClick={loadSamples} disabled={busy === 'samples'}>
            {busy === 'samples' ? 'Checking samples…' : 'Load sample messages'}
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        Last 7 days, refreshed every 15 seconds. Built from the verdict, red flags and district of
        each checked message. The message text is never stored, unless a citizen chooses to show a
        message to an officer (then with CNIC and phone numbers masked). All data is synthetic.
      </p>
      {msg && <p className="mb-3 rounded-lg bg-brand-soft p-3 text-sm">{msg}</p>}
      {loading && !map ? <Skeleton lines={4} /> : null}
      {error ? <p className="text-red-800">{staffError(error)}</p> : null}

      {map && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Messages checked" value={map.total} />
            <Tile label="Scams caught" value={map.byVerdict.SCAM} />
            <Tile
              label="Not sure → a person"
              value={map.byVerdict.UNSURE}
              note={`${pct(map.unsureShare)} of all checks`}
            />
            <Tile
              label="Genuine (seal verified)"
              value={map.genuineWithSeal}
              note={`${map.byVerdict.GENUINE} genuine in total`}
            />
            <Tile
              label="False alarms"
              value={map.humanReview.falseAlarms}
              note={`${pct(map.humanReview.falseAlarmShare)} of ${map.humanReview.confirmedScam + map.humanReview.genuine} messages an officer labelled`}
            />
          </div>

          {map.total === 0 ? (
            <Card>
              <p>
                No messages have been checked in this period. Citizens check a message under “Is
                this message real?”.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-3 font-semibold">Where each kind of scam appears</h2>
                  <Grid map={map} />
                </Card>
                <Card>
                  <h2 className="mb-3 font-semibold">Top scam patterns this week</h2>
                  <ol className="space-y-2">
                    {map.byFlag.slice(0, 6).map((f) => (
                      <li key={f.key} className="flex items-center gap-3">
                        <span className="w-8 text-right text-lg font-bold">{f.count}</span>
                        <span className="flex-1">{flagLabel(f.key)}</span>
                      </li>
                    ))}
                  </ol>
                  {map.topCombinations.length > 0 && (
                    <p className="mt-3 text-sm text-muted">
                      Most common combination:{' '}
                      {map.topCombinations[0]!.flags.map(flagLabel).join(' + ')} (
                      {map.topCombinations[0]!.count})
                    </p>
                  )}
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-3 font-semibold">By day</h2>
                  <Bars
                    rows={map.byDay.map((d) => ({
                      label: d.day.slice(5),
                      total: d.total,
                      scam: d.scam,
                    }))}
                  />
                </Card>
                <Card>
                  <h2 className="mb-3 font-semibold">By hour of day</h2>
                  <Bars
                    rows={map.byHour.map((h) => ({
                      label: h.hour % 3 === 0 ? String(h.hour) : '',
                      total: h.total,
                      scam: h.scam,
                    }))}
                  />
                </Card>
              </div>

              <Card>
                <h2 className="mb-3 font-semibold">
                  Shown to an officer by a citizen ({map.humanReview.open} open)
                </h2>
                <DataTable
                  caption="Messages citizens asked an officer to look at"
                  empty="No message has been sent to an officer yet."
                  rows={map.reports}
                  rowKey={(r) => r.reportId}
                  columns={[
                    { header: 'When', cell: (r) => when(r.at), className: 'whitespace-nowrap' },
                    {
                      header: 'System said',
                      cell: (r) => (
                        <StatusPill tone={verdictTone(r.verdict)}>{r.verdict}</StatusPill>
                      ),
                    },
                    {
                      header: 'Message (numbers masked)',
                      cell: (r) => <span dir="auto">{r.text}</span>,
                    },
                    { header: 'District', cell: (r) => r.district ?? '—' },
                    {
                      header: 'Officer decision',
                      cell: (r) =>
                        r.label ? (
                          <StatusPill tone={r.label === 'genuine' ? 'ok' : 'bad'}>
                            {r.label === 'genuine' ? 'Genuine' : 'Confirmed scam'}
                          </StatusPill>
                        ) : canLabel ? (
                          <span className="flex gap-2">
                            <Button
                              variant="danger"
                              disabled={busy === r.reportId}
                              onClick={() => resolve(r.reportId, 'confirmed_scam')}
                            >
                              Scam
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy === r.reportId}
                              onClick={() => resolve(r.reportId, 'genuine')}
                            >
                              Genuine
                            </Button>
                          </span>
                        ) : (
                          'Waiting'
                        ),
                    },
                  ]}
                />
              </Card>

              <Card>
                <h2 className="mb-3 font-semibold">Latest checks</h2>
                <DataTable
                  caption="Latest scam checks"
                  empty="Nothing yet."
                  rows={map.latest}
                  rowKey={(r) => `${r.at}-${r.redFlags.join()}-${r.confidence}`}
                  columns={[
                    { header: 'When', cell: (r) => when(r.at), className: 'whitespace-nowrap' },
                    {
                      header: 'Verdict',
                      cell: (r) => (
                        <StatusPill tone={verdictTone(r.verdict)}>{r.verdict}</StatusPill>
                      ),
                    },
                    { header: 'Confidence', cell: (r) => pct(r.confidence) },
                    { header: 'Why', cell: (r) => r.redFlags.map(flagLabel).join(', ') || '—' },
                    { header: 'District', cell: (r) => r.district ?? '—' },
                    { header: 'From', cell: (r) => r.channel },
                  ]}
                />
              </Card>
            </>
          )}
          {map.capped && (
            <p className="text-sm text-muted">
              More messages than the display limit: counts are a lower bound.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
