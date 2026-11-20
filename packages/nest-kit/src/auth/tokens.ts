import jwt from 'jsonwebtoken';
import type { AccessTokenClaims } from '@haqdaar/shared';

export const ISSUER = 'haqdaar-identity';
export const USER_AUDIENCE = 'haqdaar';

/** Verify a user access token (RS256). Only the identity service has the private key. */
export function verifyAccessToken(token: string, publicKey: string): AccessTokenClaims {
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: ISSUER,
    audience: USER_AUDIENCE,
  }) as AccessTokenClaims;
}

/** Sign a user access token. Used only by the identity service. */
export function signAccessToken(
  claims: AccessTokenClaims,
  privateKey: string,
  expiresInSeconds: number,
): string {
  return jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    issuer: ISSUER,
    audience: USER_AUDIENCE,
    expiresIn: expiresInSeconds,
  });
}

/** Short-lived (60 s) token one service uses to call another. Audience = target service. */
export function signInternalToken(from: string, to: string, secret: string): string {
  return jwt.sign({ sub: `service:${from}` }, secret, {
    algorithm: 'HS256',
    audience: `internal:${to}`,
    issuer: 'haqdaar-internal',
    expiresIn: 60,
  });
}

export function verifyInternalToken(token: string, me: string, secret: string): { service: string } {
  const payload = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    audience: `internal:${me}`,
    issuer: 'haqdaar-internal',
  }) as { sub: string };
  return { service: payload.sub.replace(/^service:/, '') };
}
