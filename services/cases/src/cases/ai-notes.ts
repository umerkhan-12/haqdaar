import { z } from 'zod';
import { maskCnic } from '@haqdaar/nest-kit';
import type { Lane } from '@haqdaar/shared';

/**
 * AI notes travel with the claim so that "I am not sure" reaches the officer with everything the
 * AI heard and saw. They are sent by the citizen's device, so they are UNTRUSTED: nothing in here
 * may raise confidence or cause an approval. They can only add caution (soft flags, human review).
 */

/** Free text is cut, not refused: an over-long transcript must never block a widow's claim. */
const text = (max: number) => z.string().transform((s) => s.slice(0, max));

/** Accepts the AI service's wrapped answer `{ extraction: {...}, needsHuman, reason }` as well as the flat form. */
function flatten(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const inner = o.extraction;
  return inner && typeof inner === 'object' && !Array.isArray(inner)
    ? { ...o, ...(inner as object), extraction: undefined }
    : o;
}

/** What the AI understood from her speech. Unknown keys are dropped. */
export const ExtractionNotes = z.preprocess(
  flatten,
  z.object({
    intent: text(40).nullish(),
    fullName: text(80).nullish(),
    cnic: text(20).nullish(),
    phone: text(20).nullish(),
    district: text(60).nullish(),
    householdSize: z.number().int().nullish(),
    isWidow: z.boolean().nullish(),
    missingFields: z.array(text(40)).max(20).nullish(),
    confidence: z.number().min(0).max(1).nullish(),
    transcript: text(2000).nullish(),
    needsHuman: z.boolean().nullish(),
    reason: text(300).nullish(),
  }),
);
export type ExtractionNotes = z.infer<typeof ExtractionNotes>;

/** Result of the CNIC photo check. `null` = she skipped the photo. Unknown keys are dropped. */
export const DocumentCheckNotes = z.object({
  cnicFromOcr: text(20).nullish(),
  cnicFromQr: text(20).nullish(),
  checks: z
    .array(z.object({ id: text(40), ok: z.boolean(), detail: text(200).nullish() }))
    .max(20)
    .default([]),
  forgeryScore: z.number().min(0).max(1).nullish(),
  blurScore: z.number().min(0).max(1).nullish(),
  needsHuman: z.boolean().nullish(),
  retakeRequired: z.boolean().nullish(),
  explanationUr: text(500).nullish(),
  explanationEn: text(500).nullish(),
});
export type DocumentCheckNotes = z.infer<typeof DocumentCheckNotes>;

/**
 * Soft flags raised from AI notes. `review` flags stop automation; `note` flags only inform the officer.
 * The texts are what the citizen hears (Urdu) and what staff read (English).
 */
export const SOFT_FLAGS = {
  ai_unsure_speech: {
    level: 'review',
    ur: 'ہمارا نظام آپ کی بات پوری طرح نہیں سمجھ سکا',
    en: 'the AI was not sure it understood her speech',
  },
  ai_cnic_differs_from_typed: {
    level: 'review',
    ur: 'سنا گیا شناختی کارڈ نمبر لکھے ہوئے نمبر سے مختلف ہے',
    en: 'the CNIC the AI heard differs from the CNIC on the claim',
  },
  document_needs_review: {
    level: 'review',
    ur: 'شناختی کارڈ کی تصویر کو ایک افسر دیکھے گا',
    en: 'the CNIC photo failed an automatic check',
  },
  document_unreadable: {
    level: 'review',
    ur: 'شناختی کارڈ کی تصویر صاف نہیں پڑھی جا سکی',
    en: 'the CNIC photo could not be read (blurry or no number found)',
  },
  document_cnic_mismatch: {
    level: 'review',
    ur: 'کارڈ کی تصویر والا نمبر لکھے ہوئے نمبر سے مختلف ہے',
    en: 'the CNIC on the photographed card differs from the CNIC on the claim',
  },
  ai_missing_fields: {
    level: 'note',
    ur: 'کچھ معلومات آواز سے نہیں ملیں',
    en: 'the AI could not find some details in her speech; they were typed or confirmed by hand',
  },
  cnic_photo_skipped: {
    level: 'note',
    ur: 'شناختی کارڈ کی تصویر نہیں دی گئی',
    en: 'no CNIC photo was given',
  },
} as const satisfies Record<string, { level: 'review' | 'note'; ur: string; en: string }>;
export type SoftFlag = keyof typeof SOFT_FLAGS;

/** Below this the AI itself says "I am not sure" (same line the AI service draws). */
export const AI_UNSURE_BELOW = 0.6;

/**
 * A typed claim scores as this extraction confidence in the engine. A voice claim may score lower,
 * never higher: the number comes from the client, so it must not buy an approval.
 */
export const TYPED_CLAIM_CONFIDENCE = 0.8;

/** Evidence value for the engine: the client's number can lower confidence but never lift it above a typed claim. */
export function trustedExtractionConfidence(extraction: unknown): number | null {
  const c = (extraction as { confidence?: unknown } | null)?.confidence;
  return typeof c === 'number' && Number.isFinite(c)
    ? Math.min(Math.max(c, 0), TYPED_CLAIM_CONFIDENCE)
    : null;
}

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
const differs = (seen: string | null | undefined, typed: string) =>
  digits(seen).length === 13 && digits(seen) !== digits(typed);

/**
 * Reasons for caution found in the AI notes. `documentCheck: undefined` (older clients, typed
 * claims by API) says nothing; `null` means the photo step was skipped.
 */
export function softFlags(
  typedCnic: string,
  extraction: ExtractionNotes | null | undefined,
  documentCheck: DocumentCheckNotes | null | undefined,
): SoftFlag[] {
  const flags = new Set<SoftFlag>();
  if (extraction) {
    const unsure =
      typeof extraction.confidence === 'number' && extraction.confidence < AI_UNSURE_BELOW;
    if (extraction.needsHuman || unsure) flags.add('ai_unsure_speech');
    if (differs(extraction.cnic, typedCnic)) flags.add('ai_cnic_differs_from_typed');
    if (extraction.missingFields?.length) flags.add('ai_missing_fields');
  }
  if (documentCheck === null) flags.add('cnic_photo_skipped');
  if (documentCheck) {
    if (documentCheck.retakeRequired) flags.add('document_unreadable');
    if (documentCheck.needsHuman || documentCheck.checks.some((c) => !c.ok))
      flags.add('document_needs_review');
    if (
      differs(documentCheck.cnicFromOcr, typedCnic) ||
      differs(documentCheck.cnicFromQr, typedCnic)
    ) {
      flags.add('document_cnic_mismatch');
    }
  }
  return [...flags];
}

export const isSoftFlag = (f: string): f is SoftFlag => f in SOFT_FLAGS;

/** The part of an engine outcome that caution may change. */
export interface CautiousOutcome {
  lane: Lane;
  confidence: number;
  explanationUr: string;
  explanationEn: string;
}

/**
 * Apply soft flags AFTER the engine has decided. The only possible changes are
 * AUTO_APPROVE → HUMAN_REVIEW and a longer explanation: the lane never becomes more permissive
 * and confidence is never touched, whatever the client sent.
 */
export function applyCaution<T extends CautiousOutcome>(outcome: T, flags: SoftFlag[]): T {
  const review = flags.filter((f) => SOFT_FLAGS[f].level === 'review');
  if (!review.length || outcome.lane === 'ASK_MORE') return outcome;
  const ur = review.map((f) => SOFT_FLAGS[f].ur).join('۔ ');
  const en = review.map((f) => SOFT_FLAGS[f].en).join('; ');
  if (outcome.lane === 'AUTO_APPROVE') {
    return {
      ...outcome,
      lane: 'HUMAN_REVIEW',
      explanationUr: `ایک افسر آپ کی درخواست دیکھے گا۔ ${ur}۔`,
      explanationEn: `An officer will review this claim: ${en}.`,
    };
  }
  return {
    ...outcome,
    explanationUr: `${outcome.explanationUr} ${ur}۔`,
    explanationEn: `${outcome.explanationEn.replace(/\.$/, '')}; ${en}.`,
  };
}

const maskMaybe = (cnic: string | null | undefined) => {
  const d = digits(cnic);
  return d.length === 13 ? maskCnic(`${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`) : null;
};

/**
 * What goes into the audit trail: enough to show WHY a human was asked, with no name, no phone,
 * no transcript text and only masked CNICs — the audit log is append-only, so PII must never enter it.
 */
export function auditNotes(
  extraction: ExtractionNotes | null | undefined,
  documentCheck: DocumentCheckNotes | null | undefined,
  flags: SoftFlag[],
) {
  return {
    softFlags: flags,
    extraction: extraction
      ? {
          intent: extraction.intent ?? null,
          confidence: extraction.confidence ?? null,
          needsHuman: extraction.needsHuman ?? false,
          reason: extraction.reason ?? null,
          missingFields: extraction.missingFields ?? [],
          cnicMasked: maskMaybe(extraction.cnic),
          transcriptChars: extraction.transcript?.length ?? 0,
        }
      : null,
    documentCheck:
      documentCheck === undefined
        ? 'not_sent'
        : documentCheck === null
          ? 'skipped'
          : {
              cnicFromOcrMasked: maskMaybe(documentCheck.cnicFromOcr),
              cnicFromQrMasked: maskMaybe(documentCheck.cnicFromQr),
              forgeryScore: documentCheck.forgeryScore ?? null,
              blurScore: documentCheck.blurScore ?? null,
              needsHuman: documentCheck.needsHuman ?? false,
              retakeRequired: documentCheck.retakeRequired ?? false,
              failedChecks: documentCheck.checks.filter((c) => !c.ok).map((c) => c.id),
            },
  };
}

/** Stored in the case's `documentCheck` column when she skipped the photo (a JSON column cannot tell null from absent). */
export const PHOTO_SKIPPED = { skipped: true } as const;

/** Read the stored extraction column back (rows written before AI notes existed parse too). */
export function storedExtraction(raw: unknown): ExtractionNotes | null {
  const r = ExtractionNotes.safeParse(raw ?? undefined);
  return r.success && raw ? r.data : null;
}

/** Read the stored document check back: object = checked, null = photo skipped, undefined = never sent. */
export function storedDocumentCheck(raw: unknown): DocumentCheckNotes | null | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if ((raw as { skipped?: unknown }).skipped === true) return null;
  const r = DocumentCheckNotes.safeParse(raw);
  return r.success ? r.data : undefined;
}

const CNIC_IN_TEXT = /\b(\d{5})[-\s]?(\d{5})(\d{2})[-\s]?(\d)\b/g;
const PHONE_IN_TEXT = /(?:\+?92[-\s]?|0)3\d{2}[-\s]?\d{3}(\d{4})\b/g;

/** Mask CNICs and mobile numbers inside free text (transcripts, check details). */
export function maskText(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(CNIC_IN_TEXT, '$1-*****$3-$4').replace(PHONE_IN_TEXT, '03*****$1');
}

/**
 * AI notes as shown on the case: the same masking as the rest of the case view (no full CNIC,
 * no full phone), with the comparisons an officer needs already made against the CNIC on the claim.
 */
export function viewNotes(typedCnic: string, extraction: unknown, documentCheck: unknown) {
  const e = storedExtraction(extraction);
  const stored = storedDocumentCheck(documentCheck);
  const d = stored ?? null;
  const same = (seen: string | null | undefined) =>
    digits(seen).length === 13 ? digits(seen) === digits(typedCnic) : null;
  return {
    extraction: e && {
      transcript: maskText(e.transcript),
      intent: e.intent ?? null,
      fullName: e.fullName ?? null,
      cnicMasked: maskMaybe(e.cnic),
      cnicMatchesClaim: same(e.cnic),
      phoneMasked: maskText(e.phone),
      district: e.district ?? null,
      householdSize: e.householdSize ?? null,
      isWidow: e.isWidow ?? null,
      missingFields: e.missingFields ?? [],
      confidence: e.confidence ?? null,
      needsHuman: e.needsHuman ?? false,
      reason: e.reason ?? null,
    },
    /** `skipped` = she chose not to take a photo; `not_sent` = the claim came without the photo step. */
    documentStatus: d ? 'checked' : stored === null ? 'skipped' : 'not_sent',
    documentCheck: d && {
      cnicFromOcrMasked: maskMaybe(d.cnicFromOcr),
      ocrMatchesClaim: same(d.cnicFromOcr),
      cnicFromQrMasked: maskMaybe(d.cnicFromQr),
      qrMatchesClaim: same(d.cnicFromQr),
      checks: d.checks.map((c) => ({ id: c.id, ok: c.ok, detail: maskText(c.detail) })),
      forgeryScore: d.forgeryScore ?? null,
      blurScore: d.blurScore ?? null,
      needsHuman: d.needsHuman ?? false,
      retakeRequired: d.retakeRequired ?? false,
      explanationEn: d.explanationEn ?? null,
      explanationUr: d.explanationUr ?? null,
    },
  };
}
