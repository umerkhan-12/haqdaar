import { z } from 'zod';
import { RAAST_FAULT_MODES } from './rails.store';

export const Cnic = z.string().regex(/^\d{5}-?\d{7}-?\d$/, 'CNIC must be 13 digits');
export const Iban = z.string().regex(/^PK\d{2}[A-Z]{4}\d{16}$/, 'Invalid Pakistani IBAN');
export const Alias = z.string().regex(/^(\+?92|0)3\d{2}-?\d{7}$/, 'Invalid mobile number');

const exactlyOne = (a: { iban?: string; alias?: string }) => !!a.iban !== !!a.alias;
const ONE_MSG = 'Provide exactly one of iban or alias';

export const NadraVerifyBody = z.object({
  cnic: Cnic,
  fullName: z.string().trim().min(1).max(100).optional(),
});

export const TitleFetchBody = z
  .object({ iban: Iban.optional(), alias: Alias.optional() })
  .refine(exactlyOne, ONE_MSG);

export const TransferBody = z.object({
  endToEndId: z.string().min(8).max(64),
  amount: z.number().positive().max(10_000_000),
  currency: z.literal('PKR'),
  debtor: z.object({ name: z.string().min(1).max(140), iban: Iban }),
  creditor: z
    .object({ name: z.string().min(1).max(140), iban: Iban.optional(), alias: Alias.optional() })
    .refine(exactlyOne, ONE_MSG),
  remittanceInfo: z.string().max(140),
});

export const StatementQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const SmsSendBody = z.object({ to: Alias, body: z.string().min(1).max(1000) });

export const FaultsBody = z.object({
  raast: z.object({
    mode: z.enum(RAAST_FAULT_MODES),
    remaining: z.number().int().min(0).max(100).default(1),
    /** Only transfers to this Raast alias are affected (deterministic demos with background traffic). */
    alias: Alias.optional(),
  }),
});
