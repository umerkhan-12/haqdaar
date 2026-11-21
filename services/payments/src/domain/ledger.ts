export type Direction = 'DEBIT' | 'CREDIT';

export interface LedgerLine {
  account: string;
  direction: Direction;
  amount: number;
}

export const ACCOUNTS = {
  programFund: 'program:sahara:fund',
  raastSettlement: 'raast:settlement',
} as const;

/** Money leaves the program fund towards the Raast settlement account. */
export function payoutLines(amount: number): LedgerLine[] {
  return assertBalanced([
    { account: ACCOUNTS.raastSettlement, direction: 'DEBIT', amount },
    { account: ACCOUNTS.programFund, direction: 'CREDIT', amount },
  ]);
}

/** Exact mirror of the payout: never edit or delete the original entries. */
export function reversalLines(amount: number): LedgerLine[] {
  return assertBalanced([
    { account: ACCOUNTS.programFund, direction: 'DEBIT', amount },
    { account: ACCOUNTS.raastSettlement, direction: 'CREDIT', amount },
  ]);
}

/** Every entry group must balance to zero, with positive whole amounts. */
export function assertBalanced(lines: LedgerLine[]): LedgerLine[] {
  if (lines.length < 2) throw new Error('A ledger entry group needs at least two lines');
  let net = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.amount) || l.amount <= 0)
      throw new Error(`Invalid amount: ${l.amount}`);
    net += l.direction === 'DEBIT' ? l.amount : -l.amount;
  }
  if (net !== 0) throw new Error(`Unbalanced entry group (net ${net})`);
  return lines;
}

export interface AccountBalance {
  account: string;
  debit: number;
  credit: number;
  /** debit - credit */
  balance: number;
}

export function deriveBalances(lines: LedgerLine[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();
  for (const l of lines) {
    const b = map.get(l.account) ?? { account: l.account, debit: 0, credit: 0, balance: 0 };
    if (l.direction === 'DEBIT') b.debit += l.amount;
    else b.credit += l.amount;
    b.balance = b.debit - b.credit;
    map.set(l.account, b);
  }
  return [...map.values()].sort((a, b) => a.account.localeCompare(b.account));
}
