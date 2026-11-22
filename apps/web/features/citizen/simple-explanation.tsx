'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type CaseDetail, type ExplainInput } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Simple {
  key: string;
  textUr: string;
  textEn: string;
}

/** The engine's reasons that carry both wordings; the citizen view may send them as a plain map (then none). */
function clausesOf(decision: NonNullable<CaseDetail['decision']>): ExplainInput['clauses'] {
  if (!Array.isArray(decision.clauses)) return [];
  return decision.clauses.flatMap((c) =>
    c.textUr && c.textEn
      ? [
          {
            textUr: c.textUr.slice(0, 300),
            textEn: c.textEn.slice(0, 300),
            passed: c.passed ?? c.ok ?? false,
          },
        ]
      : [],
  );
}

/**
 * The decision in simpler words, when the AI has one that passed the server's guardrails.
 * The engine's own sentence is shown and spoken first; this only swaps the shown text later, so the
 * result never waits on AI. Errors are ignored, and an answer is used only for the exact decision
 * and lane it was asked for (a reload with a new decision drops it).
 */
export function useSimpleExplanation(c: CaseDetail | null | undefined): string | null {
  const { lang } = useI18n();
  const [simple, setSimple] = useState<Simple | null>(null);
  const d = c?.decision ?? null;
  // Only the rule engine's lanes are explained: an officer's approval or rejection is not reworded.
  const key =
    c && d && d.decidedBy === 'system' && c.lane === d.lane && c.status !== 'REJECTED'
      ? `${c.id}:${d.id}:${d.lane}`
      : null;
  const current = useRef(key);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    current.current = key;
    if (!key || !d || asked.current === key || !d.explanationUr || !d.explanationEn) return;
    asked.current = key;
    api
      .explain({
        lane: d.lane,
        clauses: clausesOf(d).slice(0, 20),
        flags: d.hardFlags.slice(0, 20).map((f) => f.slice(0, 60)),
        templateUr: d.explanationUr.slice(0, 1000),
        templateEn: d.explanationEn.slice(0, 1000),
      })
      .then((r) => {
        if (r.source === 'ai' && current.current === key)
          setSimple({ key, textUr: r.textUr, textEn: r.textEn });
      })
      .catch(() => undefined); // the engine's sentence is already on screen
  }, [key, d]);

  if (!simple || simple.key !== key) return null;
  return lang === 'ur' ? simple.textUr : simple.textEn;
}

/** Small label under the result so she (and a judge) can tell the sentence was reworded by AI. */
export function SimpleWordsLabel() {
  const { lang } = useI18n();
  return (
    <p className="-mt-2 px-2 text-sm text-slate-600">
      {lang === 'ur' ? 'سادہ الفاظ میں' : 'In simple words'}
    </p>
  );
}
