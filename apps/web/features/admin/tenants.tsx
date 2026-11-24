'use client';

import { useState } from 'react';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Skeleton,
  StatusPill,
  staffError,
} from '@/components/ui';
import { api, type LaunchProgramInput, type Tenant, type TenantUsage } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const TYPE_LABEL: Record<Tenant['type'], string> = {
  relief: 'Relief payments',
  fraud_desk: 'Fraud and complaints desk',
};
const INPUT = 'mt-1 min-h-12 w-full rounded-lg border-2 border-slate-400 px-2';
const EMPTY: LaunchProgramInput = {
  programName: '',
  type: 'relief',
  adminName: '',
  adminPhone: '',
  adminPassword: '',
  monthlyRequestQuota: 100_000,
};
const n = (x: number) => x.toLocaleString('en-PK');
/** Same rules as the server's LaunchProgramRequest. */
const PK_MOBILE = /^(\+?92|0)3\d{9}$/;
function launchProblem(f: LaunchProgramInput): string | null {
  const name = f.programName.trim();
  if (name.length < 3 || name.length > 80) return 'Program name: 3 to 80 characters.';
  const admin = f.adminName.trim();
  if (admin.length < 2 || admin.length > 80) return "Admin's name: 2 to 80 characters.";
  if (!PK_MOBILE.test(f.adminPhone.replace(/[\s-]/g, '')))
    return 'Admin mobile must be a Pakistani mobile number, like 03001234567.';
  if (f.adminPassword.length < 8 || f.adminPassword.length > 128)
    return 'Admin password: 8 to 128 characters.';
  const q = f.monthlyRequestQuota;
  if (q !== undefined && (!Number.isInteger(q) || q < 1_000 || q > 100_000_000))
    return 'Monthly request limit: a whole number from 1,000 to 100,000,000.';
  return null;
}

/** Month-to-date requests against the plan's monthly limit. */
function QuotaBar({ q }: { q: TenantUsage['quota'] }) {
  const width = Math.min(100, q.percentUsed);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>
          <span className="text-xl font-bold">{n(q.monthToDateRequests)}</span> of{' '}
          {n(q.monthlyRequestQuota)} requests this month
        </span>
        <StatusPill tone={q.exceeded ? 'bad' : q.percentUsed >= 80 ? 'warn' : 'ok'}>
          {q.exceeded ? 'over the limit' : `${q.percentUsed}% used`}
        </StatusPill>
      </div>
      <div
        role="progressbar"
        aria-label="Monthly request quota used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        className="mt-2 h-3 rounded-full bg-slate-100"
      >
        <div
          className={`h-3 rounded-full ${q.exceeded ? 'bg-red-700' : q.percentUsed >= 80 ? 'bg-amber-600' : 'bg-brand'}`}
          style={{ width: `${width}%`, minWidth: q.monthToDateRequests ? 4 : 0 }}
        />
      </div>
    </div>
  );
}

/** Plan and usage of one program: quota bar, 7-day totals and a small daily bar chart. */
function Usage({ tenantId }: { tenantId: string }) {
  const { data, error, loading } = useAsync(() => api.tenantUsage(tenantId, 7), [tenantId]);
  if (loading && !data) return <Skeleton lines={4} />;
  if (error) return <p role="alert">{staffError(error)}</p>;
  if (!data) return null;
  const max = Math.max(1, ...data.daily.map((d) => d.requests));
  return (
    <div className="space-y-4">
      <QuotaBar q={data.quota} />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {[
          ['Requests (7 days)', n(data.totals.requests)],
          ['Errors (7 days)', n(data.totals.errors)],
          ['AI calls (7 days)', n(data.totals.aiCalls)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-slate-50 p-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-lg font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <ul aria-label="Requests per day" className="space-y-1 text-sm">
        {data.daily.map((d) => (
          <li key={d.day} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3">
            <span className="text-muted">{d.day.slice(5)}</span>
            <span className="h-3 rounded-full bg-slate-100">
              <span
                className="block h-3 rounded-full bg-brand"
                style={{ width: `${(d.requests / max) * 100}%`, minWidth: d.requests ? 4 : 0 }}
              />
            </span>
            <span className="text-right font-semibold tabular-nums">{n(d.requests)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Metered at the gateway per program. {data.note}</p>
    </div>
  );
}

/**
 * Multi-tenant workspace: every program (tenant) has its own users, rules, claims and usage quota.
 * A platform admin sees all programs and can launch a new one; a program admin sees only their own.
 */
export function AdminTenants() {
  const me = useAsync(() => api.tenantMe(), []);
  const platform = me.data?.platformAdmin === true;
  const list = useAsync(
    () => (platform ? api.tenants() : Promise.resolve<Tenant[]>([])),
    [platform],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<LaunchProgramInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const rows: Tenant[] = platform ? (list.data ?? []) : me.data ? [me.data] : [];
  const shownId = selected ?? me.data?.id ?? null;
  const shown = rows.find((t) => t.id === shownId) ?? me.data;
  const set = <K extends keyof LaunchProgramInput>(k: K, v: LaunchProgramInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const [confirm, setConfirm] = useState(false);
  const problem = launchProblem(form);
  const touched = form.programName !== '' || form.adminName !== '' || form.adminPhone !== '';

  async function launch() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.launchProgram({
        ...form,
        programName: form.programName.trim(),
        adminName: form.adminName.trim(),
        adminPhone: form.adminPhone.trim(),
      });
      setMsg({
        ok: true,
        text: `"${r.tenant.name}" is live. Its admin ${r.admin.name} (${r.admin.phoneMasked}) can log in now and starts with an empty, separate workspace.`,
      });
      setForm(EMPTY);
      setSelected(r.tenant.id);
      list.reload();
    } catch (e) {
      setMsg({ ok: false, text: staffError(e) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-1 text-xl font-bold">Programs</h1>
      <p className="mb-4 text-muted">
        One platform, many programs. Each program is a separate tenant: its own staff, rules,
        claims, API keys and usage limit. Data never crosses programs.
      </p>
      {me.loading && !me.data ? (
        <Skeleton lines={5} />
      ) : me.error ? (
        <p role="alert">{staffError(me.error)}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <div className="space-y-4">
            {list.error ? (
              <p role="alert">{staffError(list.error)}</p>
            ) : (
              <DataTable
                caption="Programs"
                rows={rows}
                rowKey={(t) => t.id}
                empty="No programs."
                columns={[
                  {
                    header: 'Program',
                    cell: (t) => (
                      <span className="font-semibold">
                        {t.name}{' '}
                        {t.id === me.data?.id && <StatusPill tone="info">you are here</StatusPill>}
                      </span>
                    ),
                  },
                  { header: 'Type', cell: (t) => TYPE_LABEL[t.type] ?? t.type },
                  { header: 'Monthly limit', cell: (t) => `${n(t.monthlyRequestQuota)} requests` },
                  { header: 'Staff and users', cell: (t) => t.users ?? '—' },
                  {
                    header: 'Since',
                    cell: (t) => new Date(t.createdAt).toLocaleDateString('en-PK'),
                  },
                  {
                    header: 'Usage',
                    cell: (t) => (
                      <Button
                        variant="ghost"
                        className="min-h-10 text-sm"
                        aria-pressed={t.id === shownId}
                        onClick={() => setSelected(t.id)}
                      >
                        {t.id === shownId ? 'Showing' : 'Show'}
                      </Button>
                    ),
                  },
                ]}
              />
            )}
            {shown && shownId && (
              <Card>
                <h2 className="text-lg font-bold">Plan and usage limits</h2>
                <p className="mb-3 text-sm text-muted">
                  {shown.name} · {TYPE_LABEL[shown.type] ?? shown.type} · plan limit{' '}
                  {n(shown.monthlyRequestQuota)} API requests per month
                </p>
                <Usage tenantId={shownId} />
              </Card>
            )}
          </div>
          <Card>
            <h2 className="text-lg font-bold">Launch a program</h2>
            {platform ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  Creates the program and its first admin in one step. Use made-up details only:
                  this is a prototype.
                </p>
                <label className="mt-3 block text-sm">
                  Program name
                  <input
                    value={form.programName}
                    onChange={(e) => set('programName', e.target.value)}
                    className={INPUT}
                    placeholder="Flood Relief 2026"
                  />
                </label>
                <label className="mt-3 block text-sm">
                  Type
                  <select
                    value={form.type}
                    onChange={(e) => set('type', e.target.value as Tenant['type'])}
                    className={INPUT}
                  >
                    <option value="relief">{TYPE_LABEL.relief}</option>
                    <option value="fraud_desk">{TYPE_LABEL.fraud_desk}</option>
                  </select>
                </label>
                <label className="mt-3 block text-sm">
                  Monthly request limit
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={form.monthlyRequestQuota ?? ''}
                    onChange={(e) =>
                      set(
                        'monthlyRequestQuota',
                        e.target.value ? Number(e.target.value) : undefined,
                      )
                    }
                    className={INPUT}
                  />
                </label>
                <label className="mt-3 block text-sm">
                  First admin&apos;s name
                  <input
                    value={form.adminName}
                    onChange={(e) => set('adminName', e.target.value)}
                    className={INPUT}
                  />
                </label>
                <label className="mt-3 block text-sm">
                  Admin mobile (03XXXXXXXXX)
                  <input
                    inputMode="tel"
                    value={form.adminPhone}
                    onChange={(e) => set('adminPhone', e.target.value)}
                    className={INPUT}
                  />
                </label>
                <label className="mt-3 block text-sm">
                  Admin password (8+ characters)
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.adminPassword}
                    onChange={(e) => set('adminPassword', e.target.value)}
                    className={INPUT}
                  />
                </label>
                {touched && problem && (
                  <p role="alert" className="mt-3 text-sm text-red-900">
                    {problem}
                  </p>
                )}
                <Button
                  className="mt-4"
                  disabled={!!problem || busy}
                  aria-busy={busy}
                  onClick={() => setConfirm(true)}
                >
                  {busy ? 'Launching…' : 'Launch program…'}
                </Button>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Only the platform admin can launch new programs. You manage this program: its rules,
                staff, API keys and limits.
              </p>
            )}
            {msg && (
              <p
                role={msg.ok ? 'status' : 'alert'}
                className={`mt-3 rounded-xl p-3 text-sm ${msg.ok ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}
              >
                {msg.text}
              </p>
            )}
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Launch "${form.programName.trim()}"?`}
        confirmLabel={busy ? 'Launching…' : 'Launch program'}
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void launch()}
      >
        <p className="text-sm">
          Creates a new program ({TYPE_LABEL[form.type]}) with a limit of{' '}
          {n(form.monthlyRequestQuota ?? 100_000)} requests a month, and its first admin{' '}
          {form.adminName.trim()}, who can sign in at once. Programs cannot be deleted from this
          screen.
        </p>
      </ConfirmDialog>
    </Shell>
  );
}
