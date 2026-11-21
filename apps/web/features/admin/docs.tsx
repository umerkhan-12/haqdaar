'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/shell';
import { Button, Card, DataTable, Skeleton, StatusPill, staffError } from '@/components/ui';
import { API_BASE, api, docsUrl } from '@/lib/api';
import { useAsync } from '@/lib/hooks';

const ABOUT: Record<string, string> = {
  identity: 'Login, programs (tenants), consents, partner API keys',
  cases: 'Claims, officer queue, rules, decisions, evaluation',
  ai: 'Urdu speech, claim extraction, scam check, AI controls',
  payments: 'Payouts, maker-checker, ledger, reconciliation, webhooks',
  audit: 'Append-only, hash-chained audit log',
  'rails-mock': 'Mock NADRA, Raast and SMS (prototype only)',
  judge: 'Judge Mode scenarios',
};

/** A copy-paste block with its own Copy button (judges try the API from a terminal). */
function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <h3 className="mr-auto font-semibold">{title}</h3>
        <Button
          variant="ghost"
          className="min-h-10 text-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="mt-1 overflow-x-auto rounded-xl bg-slate-900 p-3 text-sm text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Where partners and judges find the API: each service's interactive docs, republished by the gateway so they
 * open on a deployed site, plus the public partner flow (API key -> short-lived token -> scoped call).
 */
export function AdminDocs() {
  const { data, error, loading } = useAsync(() => api.systemStatus(), []);
  // Absolute base for the curl examples; known only in the browser.
  const [base, setBase] = useState(API_BASE);
  useEffect(() => {
    setBase(API_BASE.startsWith('/') ? `${window.location.origin}${API_BASE}` : API_BASE);
  }, []);

  const services = (data?.services ?? []).filter((s) => s.name in (data?.docs ?? {}));
  const tokenCurl = `curl -s -X POST ${base}/auth/token \\\n  -H "content-type: application/json" \\\n  -d '{"apiKey":"hq_live_PASTE_YOUR_KEY"}'`;
  const scamCurl = `curl -s -X POST ${base}/ai/scam-check \\\n  -H "authorization: Bearer PASTE_ACCESS_TOKEN" \\\n  -H "content-type: application/json" \\\n  -d '{"text":"Congratulations! You won Rs 25,000 from BISP. Send your PIN to claim."}'`;

  return (
    <Shell roles={['admin']} wide>
      <h1 className="mb-1 text-xl font-bold">API docs</h1>
      <p className="mb-4 text-muted">
        The docs are public reading. Every call still needs a login token or a partner API key.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-lg font-bold">Interactive docs per service</h2>
          {loading && !data ? (
            <Skeleton lines={5} />
          ) : error ? (
            <p role="alert">{staffError(error)}</p>
          ) : (
            <DataTable
              caption="Service API docs"
              rows={services}
              rowKey={(s) => s.name}
              empty="No services reported."
              columns={[
                {
                  header: 'Service',
                  cell: (s) => (
                    <span>
                      <span className="font-semibold">{s.name}</span>
                      <span className="block text-muted">{ABOUT[s.name] ?? ''}</span>
                    </span>
                  ),
                },
                {
                  header: 'Now',
                  cell: (s) => (
                    <StatusPill tone={s.ok ? 'ok' : 'bad'}>
                      {s.ok ? `up · ${s.ms} ms` : s.status}
                    </StatusPill>
                  ),
                },
                {
                  header: 'Docs',
                  cell: (s) => (
                    <a
                      href={docsUrl(s.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center font-semibold text-brand-dark underline"
                    >
                      Open docs
                    </a>
                  ),
                },
              ]}
            />
          )}
          <p className="mt-2 text-sm text-muted">
            Machine-readable spec: add <code className="font-mono">/json</code> to a docs address
            (OpenAPI 3). System health:{' '}
            <a href={`${API_BASE}/status`} target="_blank" rel="noreferrer" className="underline">
              {API_BASE}/status
            </a>
            .
          </p>
        </div>
        <Card>
          <h2 className="text-lg font-bold">Partner flow (banks, telcos)</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>
              An admin creates a scoped key on{' '}
              <Link href="/admin/keys" className="font-semibold underline">
                API keys
              </Link>
              . It is shown once and stored only as a hash.
            </li>
            <li>
              The partner exchanges the key for a token that lasts 15 minutes and carries only the
              key&apos;s scopes.
            </li>
            <li>
              The partner calls the API with that token. Revoking the key stops new tokens at once.
            </li>
          </ol>
          <Snippet title="1. Exchange the key for a token" code={tokenCurl} />
          <Snippet title="2. Check a message for a scam (scope scam:check)" code={scamCurl} />
          <p className="mt-3 text-sm text-muted">
            Payment status changes can also be pushed to the partner: see{' '}
            <Link href="/admin/webhooks" className="font-semibold underline">
              Webhooks
            </Link>
            .
          </p>
        </Card>
      </div>
    </Shell>
  );
}
