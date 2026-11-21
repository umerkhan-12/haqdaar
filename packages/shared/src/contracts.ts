import { z } from 'zod';
import { Role } from './domain';

// ---------- identity ----------
export const LoginRequest = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(6).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

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
