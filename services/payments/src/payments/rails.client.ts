import { Injectable } from '@nestjs/common';
import { ServiceClient } from '@haqdaar/nest-kit';
import { env } from '../env';

/** Contract: docs/CONTRACTS.md — rails-mock Raast and cases payout routes. */
export interface TitleFetch {
  found: boolean;
  accountTitle: string | null;
  bank: string | null;
  ibanMasked: string | null;
  iban: string | null;
}

export interface TransferResult {
  endToEndId: string;
  status: 'ACSC' | 'RJCT';
  providerRef: string;
  reason?: string;
}

export interface StatusResult {
  endToEndId: string;
  status: 'ACSC' | 'RJCT' | 'NOT_FOUND';
  providerRef: string | null;
}

export interface Statement {
  date: string;
  entries: { endToEndId: string; amount: number; creditorIban: string; status: string; settledAt: string }[];
}

export interface PayoutDetails {
  caseId: string;
  tenantId: string;
  personId: string;
  beneficiaryName: string;
  accountIban: string | null;
  accountAlias: string | null;
  amount: number;
}

export interface TransferRequest {
  endToEndId: string;
  amount: number;
  creditor: { name: string; iban?: string; alias?: string };
}

@Injectable()
export class RailsClient {
  constructor(private readonly client: ServiceClient) {}

  /** False while the circuit to rails is open: do not even mark a payment SENT. */
  canSend(): boolean {
    return this.client.breaker('rails-mock').canRequest();
  }

  payoutDetails(caseId: string): Promise<PayoutDetails> {
    return this.client.call('cases', `/internal/cases/${caseId}/payout`);
  }

  titleFetch(account: { iban?: string; alias?: string }): Promise<TitleFetch> {
    return this.client.call('rails-mock', '/mock/raast/title-fetch', {
      method: 'POST',
      body: account,
      idempotencyKey: `title:${account.iban ?? account.alias}`, // read-only: safe to retry
    });
  }

  /** Never retried here: a lost response becomes UNKNOWN and is settled by a status inquiry. */
  transfer(t: TransferRequest): Promise<TransferResult> {
    return this.client.call('rails-mock', '/mock/raast/transfer', {
      method: 'POST',
      retries: 0,
      timeoutMs: env.RAAST_TIMEOUT_MS,
      body: {
        endToEndId: t.endToEndId,
        amount: t.amount,
        currency: 'PKR',
        debtor: { name: env.PROGRAM_DEBTOR_NAME, iban: env.PROGRAM_DEBTOR_IBAN },
        creditor: t.creditor,
        remittanceInfo: 'Sahara relief payment',
      },
    });
  }

  status(endToEndId: string): Promise<StatusResult> {
    return this.client.call('rails-mock', `/mock/raast/status/${encodeURIComponent(endToEndId)}`);
  }

  statement(date: string): Promise<Statement> {
    return this.client.call('rails-mock', `/mock/raast/statement?date=${date}`);
  }
}
