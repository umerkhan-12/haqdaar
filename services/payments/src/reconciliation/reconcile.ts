export type ReconStatus =
  | 'matched'
  | 'missing_in_provider'
  | 'missing_in_ledger'
  | 'amount_mismatch'
  | 'duplicate_in_provider';

export interface OurPayout {
  endToEndId: string;
  amount: number;
  paymentId: string;
}

export interface ProviderEntry {
  endToEndId: string;
  amount: number;
  status: string;
}

export interface ReconItem {
  endToEndId: string;
  status: ReconStatus;
  ourAmount: number | null;
  providerAmount: number | null;
  paymentId: string | null;
}

/**
 * The Raast account is shared by every program, so its statement lists other programs' payouts too.
 * Those are not this program's business (and not "missing in our ledger"): drop them before matching.
 * An id that belongs to no program at all stays in, because that is money nobody here sent.
 */
export function forProgram(
  provider: ProviderEntry[],
  otherProgramsIds: ReadonlySet<string>,
): ProviderEntry[] {
  return provider.filter((p) => !otherProgramsIds.has(p.endToEndId));
}

/**
 * Match our settled payouts against the provider statement by end-to-end id.
 * A second settlement with the same id is flagged `duplicate_in_provider`: the bank paid twice.
 */
export function reconcile(ours: OurPayout[], provider: ProviderEntry[]): ReconItem[] {
  const settled = new Map<string, ProviderEntry[]>();
  for (const p of provider) {
    if (p.status !== 'ACSC') continue;
    settled.set(p.endToEndId, [...(settled.get(p.endToEndId) ?? []), p]);
  }

  const items: ReconItem[] = [];
  const duplicates = (endToEndId: string, entries: ProviderEntry[], paymentId: string | null) => {
    for (const extra of entries.slice(1)) {
      items.push({
        endToEndId,
        paymentId,
        ourAmount: null,
        providerAmount: extra.amount,
        status: 'duplicate_in_provider',
      });
    }
  };

  for (const o of ours) {
    const entries = settled.get(o.endToEndId) ?? [];
    settled.delete(o.endToEndId);
    const p = entries[0];
    items.push({
      endToEndId: o.endToEndId,
      paymentId: o.paymentId,
      ourAmount: o.amount,
      providerAmount: p?.amount ?? null,
      status: !p ? 'missing_in_provider' : p.amount !== o.amount ? 'amount_mismatch' : 'matched',
    });
    duplicates(o.endToEndId, entries, o.paymentId);
  }
  for (const [endToEndId, entries] of settled) {
    items.push({
      endToEndId,
      paymentId: null,
      ourAmount: null,
      providerAmount: entries[0]!.amount,
      status: 'missing_in_ledger',
    });
    duplicates(endToEndId, entries, null);
  }
  return items;
}
