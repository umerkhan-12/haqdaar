import { z } from 'zod';
import { CaseStatus, CaseType, PERSON_NAME } from '@haqdaar/shared';
import { DocumentCheckNotes, ExtractionNotes } from './ai-notes';

/** Text a person can type or say: no control characters (a NUL byte cannot even be stored). */
const plain = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/, 'Control characters are not allowed');

/** Names of people and places: letters in any script (Urdu or English), spaces and . ' - only (the sign-up rule). */
const lettersOnly = (max: number, what: string) =>
  plain(max).pipe(
    z
      .string()
      .min(2, `${what} is too short`)
      .regex(PERSON_NAME, `${what} can contain only letters, spaces and . ' -`),
  );

export const CreateCase = z.object({
  type: CaseType.default('relief_claim'),
  fullName: lettersOnly(80, 'Name'),
  cnic: z.string().regex(/^\d{5}-\d{7}-\d$/, 'CNIC format: 12345-1234567-1'),
  district: lettersOnly(60, 'District').optional(),
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

/** The citizen's answer to "please correct this": only the fields she is correcting. */
export const ResubmitBody = z.preprocess(
  (v) => v ?? {},
  z.object({
    fullName: lettersOnly(80, 'Name').optional(),
    cnic: z
      .string()
      .regex(/^\d{5}-\d{7}-\d$/, 'CNIC format: 12345-1234567-1')
      .optional(),
  }),
);
export type ResubmitBody = { fullName?: string; cnic?: string };

export const ListQuery = z.object({
  status: CaseStatus.optional(),
  /** Staff only: claims already decided (approved, rejected, paid or closed). */
  view: z.enum(['decided']).optional(),
  /** Staff only: one person's claims. */
  personId: z.string().uuid().optional(),
  /** Staff only: part of the claimant's name, or a full claim id. */
  q: plain(80).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;
/** Staff only: people named in "my information is wrong" requests. */
export const CorrectionContextQuery = z.object({
  personIds: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(50)),
});
/** An officer applies a district or household correction after checking it. */
export const CorrectionBody = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('district'),
    district: lettersOnly(60, 'District'),
    note: plain(300).optional(),
    correctionId: z.string().max(80).optional(),
  }),
  z.object({
    field: z.literal('household'),
    householdSize: z.number().int().min(1).max(30),
    note: plain(300).optional(),
    correctionId: z.string().max(80).optional(),
  }),
]);
export type CorrectionBody = z.infer<typeof CorrectionBody>;
export const ApproveBody = z.object({ note: z.string().trim().max(300).optional() });
export const RejectBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const RequestInfoBody = z.object({
  message: z.string().trim().min(5).max(500),
  /** The citizen's correction request this answers, so the officer's box shows it as handled. */
  correctionId: z.string().max(80).optional(),
});
export const AssignBody = z.object({ officerId: z.string().uuid().optional() });
/** Hand-over to a supervisor must say why, so the supervisor does not start from zero. */
export const EscalateBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const CloseBody = z.object({ note: z.string().trim().max(500).optional() });
