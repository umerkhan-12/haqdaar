export type Role = 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface Session extends Tokens {
  userId: string;
  role: Role;
  name: string;
  /** The person whose data this session works on (citizen: herself; helper: the selected family). */
  personId: string | null;
  /** Helper Mode: label of the family the helper is acting for. */
  familyLabel?: string;
}

const KEY = 'hq.session';
/** The helper's own session, kept while acting for a family so "switch family" needs no new login. */
const HELPER_KEY = 'hq.helper';

interface Claims {
  sub: string;
  role: Role;
  name: string;
  obo?: string;
}

function decode(token: string): Claims {
  const part = token.split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))));
}

export function sessionFrom(t: Tokens, familyLabel?: string): Session {
  const c = decode(t.accessToken);
  return { ...t, userId: c.sub, role: c.role, name: c.name, personId: c.obo ?? null, familyLabel };
}

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export const getSession = () => read<Session>(KEY);
export const getHelperSession = () => read<Session>(HELPER_KEY);

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event('hq:session'));
}

export function saveHelperSession(s: Session | null): void {
  if (s) localStorage.setItem(HELPER_KEY, JSON.stringify(s));
  else localStorage.removeItem(HELPER_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(HELPER_KEY);
  window.dispatchEvent(new Event('hq:session'));
}

export const HOME: Record<Role, string> = {
  citizen: '/citizen',
  helper: '/helper',
  officer: '/officer',
  admin: '/admin',
  auditor: '/auditor',
};
