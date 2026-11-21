export type ReconStatus = 'matched' | 'missing_in_provider' | 'missing_in_ledger' | 'amount_mismatch';

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

/** Match our settled payouts against the provider statement by end-to-end id. */
export function reconcile(ours: OurPayout[], provider: ProviderEntry[]): ReconItem[] {
  const settled = new Map(provider.filter((p) => p.status === 'ACSC').map((p) => [p.endToEndId, p]));
  const items: ReconItem[] = [];
  for (const o of ours) {
    const p = settled.get(o.endToEndId);
    settled.delete(o.endToEndId);
    items.push({
      endToEndId: o.endToEndId,
      paymentId: o.paymentId,
      ourAmount: o.amount,
      providerAmount: p?.amount ?? null,
      status: !p ? 'missing_in_provider' : p.amount !== o.amount ? 'amount_mismatch' : 'matched',
    });
  }
  for (const p of settled.values()) {
    items.push({
      endToEndId: p.endToEndId,
      paymentId: null,
      ourAmount: null,
      providerAmount: p.amount,
      status: 'missing_in_ledger',
    });
  }
  return items;
}
