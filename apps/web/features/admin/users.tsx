'use client';

import { useState, type FormEvent } from 'react';
import { Shell } from '@/components/shell';
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Field,
  inputCls,
  Skeleton,
  StatusPill,
  staffError,
  type Tone,
} from '@/components/ui';
import { api, type TeamMember, type TeamRole } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const ROLES: { value: TeamRole; label: string; can: string }[] = [
  {
    value: 'officer',
    label: 'Officer',
    can: 'Reviews, approves or rejects claims; releases held payments',
  },
  {
    value: 'helper',
    label: 'Community helper',
    can: 'Helps enrolled families claim, with each family’s PIN',
  },
  {
    value: 'auditor',
    label: 'Auditor',
    can: 'Reads the audit log, consent records and AI decisions; changes nothing',
  },
  { value: 'admin', label: 'Admin', can: 'Manages the team, rules, AI controls and API keys' },
];
const roleTone = (r: string): Tone =>
  r === 'admin' ? 'warn' : r === 'officer' ? 'info' : 'neutral';
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

/** Team management for a program: who can do what. Every change is checked and audited by the server. */
export function UsersPage() {
  const { data: users, error, loading, reload } = useAsync(() => api.team());
  const [form, setForm] = useState({ name: '', phone: '', role: 'officer' as TeamRole });
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<TeamMember | null>(null);
  const [promote, setPromote] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      reload();
    } catch (e) {
      setMsg(staffError(e));
    } finally {
      setBusy(false);
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.addTeamMember(form);
      setCreated({ name: r.user.name, password: r.temporaryPassword });
      setForm({ name: '', phone: '', role: 'officer' });
    });
  };

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-1 text-2xl font-bold">Team and roles</h1>
      <p className="mb-4 text-sm text-muted">
        People who work in this program. Citizens register themselves and are not listed here. A
        role change applies when that person&apos;s session next renews (within 15 minutes); a
        disabled person cannot sign in again and is signed out within 15 minutes.
      </p>
      {msg && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900" role="alert">
          {msg}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {loading && !users ? <Skeleton lines={4} /> : null}
          {error ? <p className="text-red-800">{staffError(error)}</p> : null}
          {users && (
            <DataTable
              caption="Team members"
              empty="No team members yet."
              rows={users}
              rowKey={(u) => u.id}
              columns={[
                {
                  header: 'Name',
                  cell: (u) => (
                    <span className="font-medium">
                      {u.name} {u.isYou && <span className="text-xs text-muted">(you)</span>}
                    </span>
                  ),
                },
                { header: 'Phone', cell: (u) => u.phoneMasked },
                {
                  header: 'Role',
                  cell: (u) =>
                    u.isYou ? (
                      <StatusPill tone={roleTone(u.role)}>{u.role}</StatusPill>
                    ) : (
                      <select
                        aria-label={`Role of ${u.name}`}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1"
                        value={u.role}
                        disabled={busy || !u.active}
                        onChange={(e) => {
                          const role = e.target.value as TeamRole;
                          if (role === 'admin') setPromote(u);
                          else void run(() => api.updateTeamMember(u.id, { role }));
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ),
                },
                {
                  header: 'Last sign-in',
                  cell: (u) => when(u.lastLoginAt),
                  className: 'whitespace-nowrap',
                },
                {
                  header: 'Access',
                  cell: (u) =>
                    u.isYou ? (
                      <StatusPill tone="ok">Active</StatusPill>
                    ) : u.active ? (
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirm(u)}>
                        Disable
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void run(() => api.updateTeamMember(u.id, { active: true }))}
                      >
                        Enable
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Add a team member</h2>
          <form onSubmit={add} className="space-y-3">
            <Field label="Full name">
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                minLength={2}
              />
            </Field>
            <Field label="Mobile number (sign-in name)">
              <input
                className={inputCls}
                inputMode="tel"
                placeholder="03XXXXXXXXX"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </Field>
            <Field label="Role">
              <select
                className={inputCls}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as TeamRole })}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-sm text-muted">{ROLES.find((r) => r.value === form.role)?.can}</p>
            <Button type="submit" disabled={busy} className="w-full">
              Add
            </Button>
          </form>
          {created && (
            <div
              className="mt-4 rounded-xl border-2 border-amber-700 bg-amber-50 p-3 text-amber-900"
              role="status"
            >
              <p className="font-semibold">Password for {created.name}</p>
              <p className="my-2 select-all rounded bg-white p-2 font-mono text-lg">
                {created.password}
              </p>
              <p className="text-sm">
                Shown once. Give it to them in person; it is not stored in readable form.
              </p>
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => void navigator.clipboard?.writeText(created.password)}
              >
                Copy
              </Button>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={`Disable ${confirm?.name ?? ''}?`}
        confirmLabel="Disable"
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const u = confirm;
          setConfirm(null);
          if (u) void run(() => api.updateTeamMember(u.id, { active: false }));
        }}
      >
        <p>
          They cannot sign in until an admin enables them again, and a session they already have
          ends within 15 minutes. Their past actions stay in the audit log.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!promote}
        title={`Make ${promote?.name ?? ''} an admin?`}
        confirmLabel="Make admin"
        danger
        busy={busy}
        onClose={() => setPromote(null)}
        onConfirm={() => {
          const u = promote;
          setPromote(null);
          if (u) void run(() => api.updateTeamMember(u.id, { role: 'admin' }));
        }}
      >
        <p>
          Admins can change the rules and costs, add and disable people (other admins too) and issue
          partner API keys for this program.
        </p>
      </ConfirmDialog>
    </Shell>
  );
}
