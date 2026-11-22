import { z } from 'zod';
import { CaseStatus, CaseType } from '@haqdaar/shared';
import { DocumentCheckNotes, ExtractionNotes } from './ai-notes';

/** Text a person can type or say: no control characters (a NUL byte cannot even be stored). */
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/, 'Control characters are not allowed');

export const CreateCase = z.object({
  type: CaseType.default('relief_claim'),
  fullName: plain(80).pipe(z.string().min(2)),
  cnic: z.string().regex(/^\d{5}-\d{7}-\d$/, 'CNIC format: 12345-1234567-1'),
  district: plain(60).optional(),
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
  /** What the AI understood from her speech (with transcript and its own doubt). Untrusted: can only add caution. */
  extraction: ExtractionNotes.nullish(),
  /** CNIC photo check result; `null` = she skipped the photo. Untrusted: can only add caution. */
  documentCheck: DocumentCheckNotes.nullish(),
});
export type CreateCaseBody = z.infer<typeof CreateCase>;

export const ListQuery = z.object({ status: CaseStatus.optional() });
export const ApproveBody = z.object({ note: z.string().trim().max(300).optional() });
export const RejectBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const RequestInfoBody = z.object({ message: z.string().trim().min(5).max(500) });
export const AssignBody = z.object({ officerId: z.string().uuid().optional() });
/** Hand-over to a supervisor must say why, so the supervisor does not start from zero. */
export const EscalateBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const CloseBody = z.object({ note: z.string().trim().max(500).optional() });
