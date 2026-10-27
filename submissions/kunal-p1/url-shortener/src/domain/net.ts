/**
 * Host classification for target URLs.
 *
 * Shorteners are an open-redirect primitive; pointing one at `localhost` or a
 * cloud metadata endpoint turns a link shortener into a probe inside the
 * operator's network. We therefore reject loopback/private/link-local targets
 * by default and expose `ALLOW_PRIVATE_HOSTS` for trusted local demos.
 *
 * Note on obfuscation: WHATWG `new URL()` already canonicalises numeric and
 * mixed-radix IPv4 forms (`2130706433`, `0x7f.1`, `0177.0.0.1`) to a dotted
 * quad, so parsing through `URL` before calling this module closes the classic
 * bypasses.
 */

import { isIP } from 'node:net';

const BLOCKED_EXACT_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
  'host.docker.internal',
  'gateway.docker.internal',
]);

/** Suffixes reserved for private/mDNS/internal networks (RFC 6761, RFC 6762, RFC 8375). */
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.home.arpa',
  '.corp',
  '.private',
  '.svc',
];

function stripBrackets(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function isPrivateIPv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true; // unparseable -> fail closed
  }
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC 6598
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expand an IPv6 literal into eight 16-bit groups, or `null` if unparseable. */
function expandIPv6(value: string): number[] | null {
  let address = value;

  // Convert a dotted-quad tail (::ffff:127.0.0.1) into two hex groups.
  const lastColon = address.lastIndexOf(':');
  const tail = address.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    const [o1 = 0, o2 = 0, o3 = 0, o4 = 0] = octets;
    const hi = ((o1 << 8) | o2).toString(16);
    const lo = ((o3 << 8) | o4).toString(16);
    address = `${address.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const [head, ...rest] = address.split('::');
  if (rest.length > 1) return null;
  const headGroups = head ? head.split(':') : [];
  const tailGroups = rest.length === 1 && rest[0] ? rest[0].split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (rest.length === 0 && headGroups.length !== 8) return null;
  if (rest.length === 1 && missing < 0) return null;

  const groups = [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;

  const parsed = groups.map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return Number.NaN;
    return Number.parseInt(group, 16);
  });
  return parsed.some((n) => Number.isNaN(n)) ? null : parsed;
}

function isPrivateIPv6(value: string): boolean {
  const groups = expandIPv6(value);
  if (!groups) return true; // fail closed

  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // :: unspecified

  const firstFiveZero = groups.slice(0, 5).every((g) => g === 0);
  if (firstFiveZero && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return true; // ::1 loopback

  const g0 = groups[0] ?? 0;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses:
  // classify the embedded IPv4 address, which is what actually gets connected to.
  if (firstFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    if (hi === 0 && lo === 0) return true; // ::ffff:0.0.0.0
    if (hi === 1 && lo === 0) return true; // ::1 already covered, kept explicit
    const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    return isPrivateIPv4(dotted);
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Returns true when the host points at a loopback/private/link-local/single-label
 * destination (i.e. it must not be used as a public redirect target).
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = stripBrackets(hostname).replace(/\.$/, '');
  if (host.length === 0) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIPv4(host);
  if (ipVersion === 6) return isPrivateIPv6(host);

  if (BLOCKED_EXACT_HOSTS.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // Single-label hosts ("intranet") resolve through local DNS search domains.
  if (!host.includes('.')) return true;
  return false;
}
