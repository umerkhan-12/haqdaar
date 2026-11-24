import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

/**
 * A webhook may only point at the public internet. Without this check an admin could make the
 * payments service call itself, the database network or the cloud metadata endpoint (SSRF).
 */
const BLOCKED_V4: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 carrier NAT
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local and cloud metadata
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24 protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24 documentation
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15 benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 documentation
  [0xcb007100, 24], // 203.0.113.0/24 documentation
  [0xe0000000, 3], // 224.0.0.0/3 multicast and reserved
];

function v4Blocked(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
}

const v4Number = (ip: string) =>
  ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0) >>> 0;

/** Eight 16-bit groups. Expects an address `isIP` accepted (so `::` appears at most once). */
function v6Groups(ip: string): number[] {
  let text = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4Number(dotted[1]!);
    text = `${text.slice(0, -dotted[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const part = (s: string | undefined) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const left = part(head);
  const right = part(tail);
  return tail === undefined
    ? left
    : [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

const embeddedV4 = (g: number[], at: number) => ((g[at]! << 16) | g[at + 1]!) >>> 0;

function v6Blocked(ip: string): boolean {
  const g = v6Groups(ip);
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // ::/96 covers ::, ::1 and the deprecated IPv4-compatible form ::a.b.c.d (all blocked outright).
  if (zero(0, 6)) return true;
  // ::ffff:0:0/96 IPv4-mapped and ::ffff:0:0:0/96 IPv4-translated: judge the IPv4 address inside.
  if (zero(0, 5) && g[5] === 0xffff) return v4Blocked(embeddedV4(g, 6));
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4Blocked(embeddedV4(g, 6));
  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64: a gateway would turn them into any IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  // 2002::/16 6to4 carries an IPv4 address in bits 16-47.
  if (g[0] === 0x2002) return v4Blocked(embeddedV4(g, 1));
  // 2001::/32 Teredo, 2001:db8::/32 documentation, 100::/64 discard.
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;
  if (g[0] === 0x100 && zero(1, 4)) return true;
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  const first = g[0]!;
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00
  );
}

/** True for anything that is not a plain public unicast address (and for anything that is not an IP). */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return v4Blocked(v4Number(ip));
  if (family === 6) return v6Blocked(ip);
  return true;
}

export interface PublicTarget {
  url: URL;
  /** The checked address the request must connect to. */
  address: string;
  family: 4 | 6;
}

/**
 * Throws with a plain reason when the URL is not https or resolves to a non-public address.
 * Returns the address it checked, so the request connects to exactly that one (no DNS rebinding).
 */
export async function resolvePublicUrl(raw: string): Promise<PublicTarget> {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  const first = addresses[0];
  if (!first || addresses.some((a) => isBlockedAddress(a.address)))
    throw new Error('Webhook URL must point to a public internet address');
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

export async function assertPublicUrl(raw: string): Promise<void> {
  await resolvePublicUrl(raw);
}

/** A `lookup` for the socket that answers with the checked address, whatever the name resolves to now. */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * POST to a checked target. TLS still verifies the certificate for the URL's host name (SNI and Host
 * are the name, not the IP). Redirects are never followed: a 3xx comes back as a failed status.
 */
export function postPinned(
  target: PublicTarget,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number }> {
  const { url, address, family } = target;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
        lookup: pinnedLookup(address, family),
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
