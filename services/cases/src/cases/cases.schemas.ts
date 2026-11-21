import { z } from 'zod';
import { CaseStatus, CaseType } from '@haqdaar/shared';

export const CreateCase = z.object({
  type: CaseType.default('relief_claim'),
  fullName: z.string().trim().min(2).max(80),
  cnic: z.string().regex(/^\d{5}-\d{7}-\d$/, 'CNIC format: 12345-1234567-1'),
  district: z.string().trim().max(60).optional(),
  householdSize: z.number().int().min(1).max(30).optional(),
  payout: z
    .object({
      alias: z
        .string()
        .regex(/^03\d{9}$/, 'Raast alias: mobile number 03XXXXXXXXX')
        .optional(),
      iban: z
        .string()
        .regex(/^PK\d{2}[A-Z]{4}\d{16}$/, 'Pakistani IBAN (24 chars)')
        .optional(),
    })
    .refine((p) => !!p.alias !== !!p.iban, 'Give exactly one of payout.alias or payout.iban'),
  /** Output of the AI extraction when the claim came from voice. */
  extraction: z
    .object({
      confidence: z.number().min(0).max(1),
      householdSize: z.number().int().nullish(),
      isWidow: z.boolean().nullish(),
    })
    .passthrough()
    .optional(),
});
export type CreateCaseBody = z.infer<typeof CreateCase>;

export const ListQuery = z.object({ status: CaseStatus.optional() });
export const ApproveBody = z.object({ note: z.string().trim().max(300).optional() });
export const RejectBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const RequestInfoBody = z.object({ message: z.string().trim().min(5).max(500) });
export const AssignBody = z.object({ officerId: z.string().uuid().optional() });
