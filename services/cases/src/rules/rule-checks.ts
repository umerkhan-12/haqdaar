import { autoApproveThreshold, CostSettings, MIN_AUTO_APPROVE_THRESHOLD } from '@haqdaar/shared';
import type { Clause } from '../engine/rules';

/** Cost settings an admin may save: the threshold they give must stay high enough to be safe. */
export const CostBody = CostSettings.refine(
  (c) => autoApproveThreshold(c) >= MIN_AUTO_APPROVE_THRESHOLD,
  (c) => ({
    message: `These costs would auto-approve at confidence ${Math.max(0, autoApproveThreshold(c)).toFixed(3)}. The threshold must stay at ${MIN_AUTO_APPROVE_THRESHOLD} or more, so a wrong approval must cost at least ${Math.round(1 / (1 - MIN_AUTO_APPROVE_THRESHOLD))} times a human review.`,
  }),
).refine((c) => c.askMore <= c.humanReview, {
  message: 'Asking for more information cannot cost more than a human review',
});

/** Every number literal in a JSON Logic tree, except inside `var` (a fact path or its default). */
export function logicNumbers(node: unknown): number[] {
  if (typeof node === 'number') return [node];
  if (Array.isArray(node)) return node.flatMap(logicNumbers);
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([op, arg]) => (op === 'var' ? [] : logicNumbers(arg)));
  return [];
}

const WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/** Numbers written in a clause text: digits (Latin, Urdu or Arabic, with thousands separators) and English words up to twenty. */
export function textNumbers(text: string): number[] {
  const latin = text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٬]/g, ',');
  const digits = [...latin.matchAll(/\d[\d,]*(\.\d+)?/g)].map((m) =>
    Number(m[0].replace(/,/g, '').replace(/\.$/, '')),
  );
  const words = [...latin.toLowerCase().matchAll(/[a-z]+/g)]
    .map((m) => WORDS[m[0]])
    .filter((n): n is number => n !== undefined);
  return [...digits, ...words];
}

const sameSet = (a: number[], b: number[]) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((n) => y.has(n));
};
const list = (ns: number[]) => [...new Set(ns)].map((n) => n.toLocaleString('en-US')).join(', ');

/**
 * Citizens hear the clause texts, not the logic. A text that still says an old limit tells her the
 * wrong rule, so every number in a text must be one the logic uses and the other way round.
 * Urdu texts usually spell numbers as words: then a changed number with an unchanged Urdu text is refused.
 */
export function clauseTextProblems(clauses: Clause[], live: Clause[] = []): string[] {
  const problems: string[] = [];
  for (const c of clauses) {
    const inLogic = logicNumbers(c.logic);
    const en = textNumbers(c.textEn);
    if (!sameSet(inLogic, en))
      problems.push(
        `Clause "${c.id}": the English text says ${en.length ? list(en) : 'no number'} but the rule uses ${inLogic.length ? list(inLogic) : 'no number'}.`,
      );
    const ur = textNumbers(c.textUr);
    const before = live.find((l) => l.id === c.id);
    if (ur.length) {
      if (!sameSet(inLogic, ur))
        problems.push(
          `Clause "${c.id}": the Urdu text says ${list(ur)} but the rule uses ${inLogic.length ? list(inLogic) : 'no number'}.`,
        );
    } else if (
      before &&
      before.textUr === c.textUr &&
      !sameSet(logicNumbers(before.logic), inLogic)
    ) {
      problems.push(`Clause "${c.id}": the limit changed, so update the Urdu text too.`);
    }
  }
  return problems;
}
