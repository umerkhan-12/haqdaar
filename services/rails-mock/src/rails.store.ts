import { randomUUID } from 'node:crypto';
import type { Account, Household, PersonRecord, SeedData } from './data/seed-data';
import { nameScore } from './names';

export const RAAST_FAULT_MODES = [
  'none',
  'fail',
  'timeout',
  'timeout_after_debit',
  'duplicate_statement',
] as const;
export type RaastFaultMode = (typeof RAAST_FAULT_MODES)[number];
export interface Faults {
  raast: { mode: RaastFaultMode; remaining: number; alias?: string };
}

/** Longer than any caller's timeout, so the caller sees a timeout. */
export const TIMEOUT_DELAY_MS = 8000;
export const NAME_MATCH_THRESHOLD = 0.85;

export interface TransferRequest {
  endToEndId: string;
  amount: number;
  currency: 'PKR';
  debtor: { name: string; iban: string };
  creditor: { name: string; iban?: string; alias?: string };
  remittanceInfo: string;
}

export interface TransferResult {
  endToEndId: string;
  status: 'ACSC' | 'RJCT';
  providerRef: string;
  reason?: string;
}

interface Settlement {
  result: TransferResult;
  amount: number;
  creditorIban: string | null;
  settledAt: Date;
}

/** A settlement as it is written to disk (dates as ISO text). */
export type SavedSettlement = Omit<Settlement, 'settledAt'> & { settledAt: string };

/**
 * Where the simulated bank keeps its book between restarts. A real bank never forgets a transfer;
 * without this, every redeploy would make reconciliation report our own settled payouts as missing.
 */
export interface Journal {
  load(): SavedSettlement[];
  save(all: SavedSettlement[]): void;
}

/** Wallets opened for people who registered themselves, kept across restarts like the book. */
export interface SavedWallet {
  alias: string;
  title: string;
}
export interface WalletJournal {
  load(): SavedWallet[];
  save(all: SavedWallet[]): void;
}

export interface SmsMessage {
  messageId: string;
  from: string;
  body: string;
  receivedAt: string;
}

export const normalizeCnic = (cnic: string) =>
  cnic.replace(/\D/g, '').replace(/^(\d{5})(\d{7})(\d)$/, '$1-$2-$3');

export const normalizeAlias = (alias: string) => {
  const d = alias.replace(/\D/g, '');
  return d.startsWith('92') ? `0${d.slice(2)}` : d;
};

const maskIban = (iban: string) =>
  `${iban.slice(0, 8)}${'*'.repeat(iban.length - 12)}${iban.slice(-4)}`;

/** Statement dates follow Pakistan time (UTC+5), like a local bank statement. */
export const pktDate = (d: Date) =>
  new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

/**
 * In-memory simulated rails. Pure logic, no Nest: transfers are deduplicated by endToEndId
 * (a settled transfer is never debited twice), faults are consumed one call at a time.
 */
export class RailsStore {
  private readonly people = new Map<string, PersonRecord>();
  private readonly households = new Map<string, Household>();
  private readonly byIban = new Map<string, Account>();
  private readonly byAlias = new Map<string, Account>();
  private readonly transfers = new Map<string, Settlement>();
  private readonly inboxes = new Map<string, SmsMessage[]>();
  private readonly wallets: SavedWallet[] = [];
  private faults: Faults = { raast: { mode: 'none', remaining: 0 } };
  private refSeq = 0;

  constructor(
    seed: SeedData,
    private readonly now: () => Date = () => new Date(),
    private readonly journal?: Journal,
    private readonly walletJournal?: WalletJournal,
  ) {
    for (const p of seed.people) this.people.set(p.cnic, p);
    for (const h of seed.households) this.households.set(h.cnic, h);
    for (const a of [...seed.accounts, seed.programAccount]) {
      this.byIban.set(a.iban, a);
      if (a.alias) this.byAlias.set(a.alias, a);
    }
    for (const t of journal?.load() ?? []) {
      this.transfers.set(t.result.endToEndId, { ...t, settledAt: new Date(t.settledAt) });
    }
    this.refSeq = this.transfers.size;
    // A registered citizen's wallet must survive a restart: otherwise her payout fails "no account".
    for (const w of walletJournal?.load() ?? []) this.openWallet(w.alias, w.title, false);
  }

  private remember(): void {
    this.journal?.save(
      [...this.transfers.values()].map((t) => ({ ...t, settledAt: t.settledAt.toISOString() })),
    );
  }

  /**
   * SIMULATION: a person who registers gets a mobile wallet on their own number, in their registered
   * name, the way a real citizen already has one before they ever meet this program. An existing
   * account is never changed, so a mule cannot retitle someone else's number.
   */
  openWallet(alias: string, title: string, save = true): { opened: boolean } {
    const number = normalizeAlias(alias);
    if (this.byAlias.has(number)) return { opened: false };
    const account: Account = {
      iban: `PK00WALT${number.padStart(16, '0')}`,
      alias: number,
      title: title.trim().toUpperCase(),
      bank: 'Mock Wallet',
      cnic: null,
    };
    this.byIban.set(account.iban, account);
    this.byAlias.set(number, account);
    this.wallets.push({ alias: number, title: account.title });
    if (save) this.walletJournal?.save(this.wallets);
    return { opened: true };
  }

  get counts() {
    return { people: this.people.size, accounts: this.byIban.size, transfers: this.transfers.size };
  }

  verifyNadra(cnic: string, fullName?: string) {
    const record = this.people.get(normalizeCnic(cnic)) ?? null;
    const score = record && fullName ? nameScore(fullName, record.fullName) : null;
    return {
      match: !!record && (score === null || score >= NAME_MATCH_THRESHOLD),
      nameScore: score,
      record,
    };
  }

  household(cnic: string): Household | null {
    return this.households.get(normalizeCnic(cnic)) ?? null;
  }

  titleFetch(target: { iban?: string; alias?: string }) {
    const account = this.resolve(target);
    return {
      found: !!account,
      accountTitle: account?.title ?? null,
      bank: account?.bank ?? null,
      ibanMasked: account ? maskIban(account.iban) : null,
      iban: account?.iban ?? null,
    };
  }

  /** Returns the result plus how long the caller should be kept waiting. */
  transfer(req: TransferRequest): { result: TransferResult; delayMs: number } {
    const existing = this.transfers.get(req.endToEndId);
    if (existing) return { result: existing.result, delayMs: 0 };

    const creditor = this.resolve(req.creditor);
    // Targeted faults match the resolved account, whether the payer used the IBAN or the alias.
    const fault = this.takeFault(
      ['fail', 'timeout', 'timeout_after_debit'],
      creditor?.alias ?? req.creditor.alias,
    );
    // Fault rejections settle nothing and are not remembered, so the same id can be retried.
    if (fault === 'fail') return { result: this.reject(req, 'PROVIDER_UNAVAILABLE'), delayMs: 0 };
    if (fault === 'timeout')
      return { result: this.reject(req, 'TIMEOUT'), delayMs: TIMEOUT_DELAY_MS };

    const debtor = this.byIban.get(req.debtor.iban);
    const result = !debtor
      ? this.reject(req, 'AC02_INVALID_DEBTOR_ACCOUNT')
      : !creditor
        ? this.reject(req, 'AC03_INVALID_CREDITOR_ACCOUNT')
        : { endToEndId: req.endToEndId, status: 'ACSC' as const, providerRef: this.nextRef() };

    this.transfers.set(req.endToEndId, {
      result,
      amount: req.amount,
      creditorIban: creditor?.iban ?? null,
      settledAt: this.now(),
    });
    this.remember();
    return { result, delayMs: fault === 'timeout_after_debit' ? TIMEOUT_DELAY_MS : 0 };
  }

  status(endToEndId: string) {
    const t = this.transfers.get(endToEndId);
    return t
      ? { endToEndId, status: t.result.status, providerRef: t.result.providerRef }
      : { endToEndId, status: 'NOT_FOUND' as const, providerRef: null };
  }

  statement(date: string) {
    const entries = [...this.transfers.values()]
      .filter((t) => t.result.status === 'ACSC' && pktDate(t.settledAt) === date)
      .map((t) => ({
        endToEndId: t.result.endToEndId,
        amount: t.amount,
        creditorIban: t.creditorIban,
        status: t.result.status,
        settledAt: t.settledAt.toISOString(),
      }));
    if (entries.length && this.takeFault(['duplicate_statement'])) entries.push({ ...entries[0]! });
    return { date, entries };
  }

  sendSms(to: string, body: string, from = 'SAHARA'): { messageId: string } {
    const phone = normalizeAlias(to);
    const msg: SmsMessage = {
      messageId: randomUUID(),
      from,
      body,
      receivedAt: this.now().toISOString(),
    };
    this.inboxes.set(phone, [msg, ...(this.inboxes.get(phone) ?? [])]);
    return { messageId: msg.messageId };
  }

  inbox(phone: string): SmsMessage[] {
    return this.inboxes.get(normalizeAlias(phone)) ?? [];
  }

  getFaults(): Faults {
    return structuredClone(this.faults);
  }

  /** Demo reset: forget transfers, statements and SMS; reference data (people, accounts) stays. */
  resetActivity(): { transfers: number; inboxes: number } {
    const out = { transfers: this.transfers.size, inboxes: this.inboxes.size };
    this.transfers.clear();
    this.remember();
    this.inboxes.clear();
    this.setFaults({ raast: { mode: 'none', remaining: 0 } });
    return out;
  }

  setFaults(f: Faults): Faults {
    this.faults =
      f.raast.mode === 'none' ? { raast: { mode: 'none', remaining: 0 } } : structuredClone(f);
    return this.getFaults();
  }

  private takeFault(modes: RaastFaultMode[], creditorAlias?: string): RaastFaultMode | null {
    const f = this.faults.raast;
    if (!modes.includes(f.mode) || f.remaining <= 0) return null;
    if (f.alias && (!creditorAlias || normalizeAlias(creditorAlias) !== normalizeAlias(f.alias)))
      return null;
    const mode = f.mode;
    f.remaining -= 1;
    if (f.remaining === 0) f.mode = 'none';
    return mode;
  }

  private resolve(target: { iban?: string; alias?: string }): Account | null {
    if (target.iban) return this.byIban.get(target.iban) ?? null;
    if (target.alias) return this.byAlias.get(normalizeAlias(target.alias)) ?? null;
    return null;
  }

  private reject(req: TransferRequest, reason: string): TransferResult {
    return { endToEndId: req.endToEndId, status: 'RJCT', providerRef: this.nextRef(), reason };
  }

  private nextRef(): string {
    this.refSeq += 1;
    return `RAAST${pktDate(this.now()).replace(/-/g, '')}${String(this.refSeq).padStart(6, '0')}`;
  }
}
