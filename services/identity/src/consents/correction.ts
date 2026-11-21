import { z } from 'zod';

/** The four facts a citizen can say are wrong; a closed list so the request is one big button, not typing. */
export const CorrectionField = z.enum(['name', 'cnic', 'district', 'household']);

/**
 * Body of `POST /consents/correction-request`. The note is optional (she may not be able to type)
 * and short: it lands in the audit log, which must not become a dump of free text.
 */
export const CorrectionRequestBody = z
  .object({
    field: CorrectionField,
    note: z.string().trim().min(1).max(280).optional(),
  })
  .strict();
export type CorrectionRequestBody = z.infer<typeof CorrectionRequestBody>;
