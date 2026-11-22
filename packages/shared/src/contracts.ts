import { z } from 'zod';
import { Role, TenantType } from './domain';

// ---------- identity ----------
export const LoginRequest = z.object({
  phone: z.string().min(10).max(15),
  /** Staff password, or the 4-digit PIN a citizen chose at sign-up. */
  password: z.string().min(4).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** A person's name: letters of any script (Urdu included), spaces, dot, apostrophe, hyphen. No digits or control characters. */
export const PERSON_NAME = /^\p{L}[\p{L}\p{M}‌ .'-]*$/u;

/** A PIN anyone would try first: one digit repeated (0000) or a run up or down (1234, 4321). */
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1]! - d[0]!;
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step);
}

/** Citizen self sign-up, step 1: a Pakistani mobile number, 03XXXXXXXXX. */
export const SignupStartRequest = z.object({
  phone: z.string().regex(/^03\d{9}$/, 'Mobile number must look like 03XXXXXXXXX'),
});
export type SignupStartRequest = z.infer<typeof SignupStartRequest>;

/** Step 2: the 6-digit SMS code, the citizen's name and the 4-digit PIN they will log in with. */
export const SignupVerifyRequest = SignupStartRequest.extend({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  fullName: z.string().trim().min(2).max(80).regex(PERSON_NAME, 'Name must be letters only'),
  pin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .refine((p) => !isWeakPin(p), 'PIN is too easy to guess'),
});
export type SignupVerifyRequest = z.infer<typeof SignupVerifyRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20) });

export const TokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});
export type TokenPair = z.infer<typeof TokenPair>;

/** Claims inside the RS256 access token. */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  role: Role;
  name: string;
  /** Helper Mode: the family this helper is currently acting for. */
  obo?: string;
  /** Partner (API key) tokens only: allowed scopes. */
  scp?: string[];
}

/** "Launch a program": a new tenant and its first admin, created together (platform admin only). */
export const LaunchProgramRequest = z.object({
  programName: z.string().trim().min(3).max(80),
  type: TenantType,
  adminName: z.string().trim().min(2).max(80),
  /** Pakistani mobile: 03XXXXXXXXX, +923XXXXXXXXX or 923XXXXXXXXX (spaces/dashes allowed). */
  adminPhone: z
    .string()
    .max(20)
    .refine(
      (p) => /^(\+?92|0)3\d{9}$/.test(p.replace(/[\s-]/g, '')),
      'Not a Pakistani mobile number',
    ),
  adminPassword: z.string().min(8).max(128),
  monthlyRequestQuota: z.number().int().min(1_000).max(100_000_000).optional(),
});
export type LaunchProgramRequest = z.infer<typeof LaunchProgramRequest>;

export const DEFAULT_MONTHLY_REQUEST_QUOTA = 100_000;

/** Gateway → identity (`POST /internal/usage`): request counts since the last flush. */
export const UsageBatch = z.object({
  entries: z
    .array(
      z.object({
        tenantId: z.string().uuid(),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        service: z.string().min(1).max(40),
        requests: z.number().int().min(0),
        errors: z.number().int().min(0),
      }),
    )
    .max(10_000),
});
export type UsageBatch = z.infer<typeof UsageBatch>;

// ---------- ai ----------
export const ClaimExtraction = z.object({
  intent: z.enum(['claim_payment', 'check_status', 'report_scam', 'complaint', 'other']),
  fullName: z.string().nullable(),
  cnic: z
    .string()
    .regex(/^\d{5}-\d{7}-\d$/)
    .nullable(),
  phone: z.string().nullable(),
  district: z.string().nullable(),
  householdSize: z.number().int().min(1).max(30).nullable(),
  isWidow: z.boolean().nullable(),
  missingFields: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type ClaimExtraction = z.infer<typeof ClaimExtraction>;

export const ScamCheckRequest = z.object({
  text: z.string().min(1).max(2000),
  sender: z.string().max(40).optional(),
});

export const ScamVerdict = z.object({
  verdict: z.enum(['GENUINE', 'SCAM', 'UNSURE']),
  confidence: z.number().min(0).max(1),
  sealValid: z.boolean().nullable(),
  redFlags: z.array(z.string()),
  explanationUr: z.string(),
  explanationEn: z.string(),
});
export type ScamVerdict = z.infer<typeof ScamVerdict>;

// ---------- common ----------
export const ErrorBody = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
