'use client';

import Link from 'next/link';
import { useEffect, useRef, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { ApiError, type ScamVerdict } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconShield,
  IconSpeaker,
  IconWifiOff,
  IconX,
} from './icons';

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral';

/** 900-text on 50-tint: every pair ≥ 8 : 1 (DESIGN.md §3). */
const TONE: Record<Tone, string> = {
  ok: 'bg-green-50 border-green-700 text-green-900',
  bad: 'bg-red-50 border-red-700 text-red-900',
  warn: 'bg-amber-50 border-amber-700 text-amber-900',
  info: 'bg-brand-soft border-brand text-brand-dark',
  neutral: 'bg-white border-slate-300 text-ink',
};
const TONE_ICON: Record<Tone, ComponentType<SVGProps<SVGSVGElement>>> = {
  ok: IconCheck,
  bad: IconX,
  warn: IconAlert,
  info: IconClock,
  neutral: IconClock,
};

export const laneTone = (lane: string | null): Tone =>
  lane === 'AUTO_APPROVE'
    ? 'ok'
    : lane === 'ASK_MORE'
      ? 'warn'
      : lane === 'HUMAN_REVIEW'
        ? 'info'
        : 'neutral';

// ---------- actions ----------

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-slate-400',
    ghost: 'border-2 border-brand bg-white text-brand-dark hover:bg-brand-soft disabled:opacity-50',
    danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400',
  }[variant];
  return (
    <button
      className={`min-h-12 rounded-xl px-5 text-lg font-semibold ${v} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Navigation that looks like the primary button (never a <button> nested inside a link). */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      replace
      href={href}
      className="flex min-h-12 w-full items-center justify-center rounded-xl bg-brand px-5 text-lg font-semibold text-white hover:bg-brand-dark"
    >
      {children}
    </Link>
  );
}

/** Citizen home action: big icon + label, 96 px tall, one tap. */
export function BigActionCard({
  href,
  icon: Icon,
  label,
  tone = 'info',
}: {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tone?: Tone;
}) {
  return (
    <Link
      replace
      href={href}
      className={`flex min-h-24 w-full items-center gap-4 rounded-2xl border-2 p-5 text-start text-xl font-semibold shadow-sm motion-safe:active:scale-[0.99] ${TONE[tone]}`}
    >
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/80">
        <Icon className="h-8 w-8" />
      </span>
      <span>{label}</span>
    </Link>
  );
}

/** Speaks any text aloud: the voice channel of every state (DESIGN.md: never colour alone). */
export function AudioButton({
  text,
  className = '',
}: {
  text: string | string[];
  className?: string;
}) {
  const { t, speak } = useI18n();
  return (
    <button
      type="button"
      onClick={() => speak(text)}
      className={`inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full border-2 border-current ${className}`}
      aria-label={`${t('listen')}: ${Array.isArray(text) ? text.join('. ') : text}`}
    >
      <IconSpeaker className="h-6 w-6" />
    </button>
  );
}

// ---------- states ----------

/** The single way to show a state: icon + words + audio, announced to screen readers. */
export function StatusCard({
  tone,
  title,
  body,
  urgent = false,
}: {
  tone: Tone;
  title: string;
  body?: string;
  urgent?: boolean;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={`flex items-start gap-4 rounded-2xl border-2 p-4 ${TONE[tone]}`}
    >
      <Icon className="mt-1 h-8 w-8 shrink-0" />
      <div className="flex-1">
        <p className="text-lg font-semibold">{title}</p>
        {body && <p className="mt-1">{body}</p>}
      </div>
      <AudioButton text={body ? [title, body] : title} />
    </div>
  );
}

/** Reserves space while loading so nothing jumps when data arrives. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t('loading')} className="space-y-3 p-2">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-14 rounded-xl bg-slate-200 motion-safe:animate-pulse" />
      ))}
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="space-y-4">
      <StatusCard tone="neutral" title={title} />
      {action}
    </div>
  );
}

/** Citizens see plain words + a short reference; never raw error text. */
/** Refusals the server explains with a code: what went wrong, and what she can do about it. */
const REASONS: Record<string, [title: MessageKey, help: MessageKey]> = {
  CNIC_TAKEN: ['errCnicTaken', 'errCnicTakenHelp'],
  CNIC_MISMATCH: ['errCnicMismatch', 'errCnicMismatchHelp'],
  CNIC_LOCKED: ['errCnicLocked', 'errCnicLockedHelp'],
};

export const errorReason = (code?: string) => (code ? REASONS[code] : undefined) ?? null;

/** What ErrorState shows for a failure, as message keys, so a screen can also speak it. */
export function errorWords(error: unknown): [title: MessageKey, help?: MessageKey] {
  const e = error instanceof ApiError ? error : null;
  const reason = errorReason(e?.code);
  if (reason) return reason;
  return [e?.offline ? 'offline' : e?.status === 403 ? 'forbidden' : 'error'];
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const e = error instanceof ApiError ? error : null;
  const [title, help] = errorWords(error);
  return (
    <div className="space-y-3">
      <StatusCard
        tone={e?.offline ? 'warn' : 'bad'}
        title={t(title)}
        body={help ? t(help) : undefined}
        urgent
      />
      {e?.requestId && <p className="latin text-xs text-muted">ref {e.requestId.slice(0, 8)}</p>}
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </div>
  );
}

export function OfflineBanner({ online, waiting }: { online: boolean; waiting: number }) {
  const { t } = useI18n();
  if (online && waiting === 0) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b-2 border-amber-700 bg-amber-100 px-4 py-2 font-semibold text-amber-900"
    >
      {!online && <IconWifiOff className="h-6 w-6 shrink-0" />}
      <span className="flex-1">
        {!online && t('offline')} {waiting > 0 && `${waiting} ${t('outboxPending')}`}
      </span>
    </div>
  );
}

// ---------- domain displays ----------

const VERDICT: Record<
  ScamVerdict['verdict'],
  { tone: Tone; key: MessageKey; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  GENUINE: { tone: 'ok', key: 'verdictGENUINE', Icon: IconShield },
  SCAM: { tone: 'bad', key: 'verdictSCAM', Icon: IconX },
  UNSURE: { tone: 'warn', key: 'verdictUNSURE', Icon: IconAlert },
};

export function VerdictCard({ v }: { v: ScamVerdict }) {
  const { t, lang } = useI18n();
  const { tone, key, Icon } = VERDICT[v.verdict];
  const reason = lang === 'ur' ? v.explanationUr : v.explanationEn;
  return (
    <div role="status" className={`space-y-3 rounded-2xl border-4 p-5 ${TONE[tone]}`}>
      <div className="flex items-center gap-4">
        <Icon className="h-12 w-12 shrink-0" />
        <p className="flex-1 text-2xl font-bold">{t(key)}</p>
        <AudioButton text={[t(key), reason]} />
      </div>
      <p className="text-lg">{reason}</p>
      {v.sealValid && (
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-semibold ${TONE.ok}`}
        >
          <IconCheck className="h-4 w-4" />
          {t('receiptSeal')}
        </span>
      )}
    </div>
  );
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={`latin inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

export function Timeline({
  events,
  done = false,
  lang = 'en',
}: {
  events: { label: string; at: string }[];
  /** True when nothing more will happen (paid, closed, rejected): the last step is ticked too. */
  done?: boolean;
  /** Dates are written in the screen's language (staff screens stay English). */
  lang?: 'ur' | 'en';
}) {
  return (
    <ol className="space-y-2">
      {events.map((e, i) => {
        const last = !done && i === events.length - 1;
        return (
          <li key={i} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
            {last ? (
              <IconClock className="h-6 w-6 shrink-0 text-brand" />
            ) : (
              <IconCheck className="h-6 w-6 shrink-0 text-green-700" />
            )}
            <span className="flex-1">{e.label}</span>
            <time className={`text-sm text-muted ${lang === 'en' ? 'latin' : ''}`} dateTime={e.at}>
              {new Date(e.at).toLocaleString(lang === 'ur' ? 'ur-PK' : 'en-PK', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- forms ----------

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-base font-medium">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'latin min-h-12 w-full rounded-xl border-2 border-slate-400 bg-white px-3 text-lg text-ink focus:border-brand';

/** Numeric PIN entry without a keyboard: 64 px keys, masked dots, LTR digits in RTL pages. */
export function PinPad({
  length = 4,
  value,
  onChange,
  label,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const { t } = useI18n();
  const press = (d: string) => value.length < length && onChange(value + d);
  return (
    <div className="space-y-4" dir="ltr">
      <div
        role="status"
        aria-label={`${label}: ${value.length} / ${length}`}
        className="flex justify-center gap-3"
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={`h-5 w-5 rounded-full border-2 border-brand ${i < value.length ? 'bg-brand' : ''}`}
          />
        ))}
      </div>
      <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="latin h-16 rounded-2xl bg-white text-2xl font-semibold shadow-sm active:bg-brand-soft"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label={t('pinDelete')}
          className="h-16 rounded-2xl bg-white text-2xl shadow-sm"
        >
          ⌫
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className="latin h-16 rounded-2xl bg-white text-2xl font-semibold shadow-sm"
        >
          0
        </button>
        <span />
      </div>
    </div>
  );
}

// ---------- staff ----------

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

/** Semantic table for staff lists; columns render cells, rows can carry an action. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  caption,
}: {
  rows: T[];
  columns: { header: string; cell: (r: T) => ReactNode; className?: string }[];
  rowKey: (r: T) => string;
  empty: string;
  caption: string;
}) {
  if (!rows.length)
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-muted">{empty}</p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 text-xs uppercase text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-3 py-2 ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-t border-slate-100 align-top">
              {columns.map((c) => (
                <td key={c.header} className={`px-3 py-2 ${c.className ?? ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Native <dialog> for irreversible actions: focus is trapped and returned by the browser. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="latin w-[min(32rem,92vw)] rounded-2xl p-0 backdrop:bg-black/40"
      aria-labelledby="dlg-title"
    >
      <div className="space-y-4 p-5">
        <h2 id="dlg-title" className="text-lg font-bold">
          {title}
        </h2>
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            type="button"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Staff screens show the exact server message (officers need it) with its reference id. */
export function staffError(e: unknown): string {
  if (e instanceof ApiError)
    return e.offline
      ? 'No connection to the server.'
      : `${e.message}${e.requestId ? ` (ref ${e.requestId.slice(0, 8)})` : ''}`;
  return 'Unexpected error';
}
