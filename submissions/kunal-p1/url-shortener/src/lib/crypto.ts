/**
 * Privacy helpers.
 *
 * Click rows keep a *keyed* hash of the client IP (HMAC-SHA256), never the raw
 * address. This supports unique-visitor counts and abuse investigation while
 * remaining non-reversible without the server-side salt, so a database leak
 * does not expose visitor IPs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export function hashIp(ip: string | undefined | null, salt: string): string | null {
  if (!ip) return null;
  // Strip the IPv4-mapped IPv6 prefix so `::ffff:1.2.3.4` and `1.2.3.4` collapse.
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return createHmac('sha256', salt).update(normalized, 'utf8').digest('hex').slice(0, 32);
}

/** Truncate free-form header values before storage (defensive against huge UA strings). */
export function truncate(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Constant-time string comparison for API keys. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Compare against itself to keep timing independent of length mismatch.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** True when any configured key matches the presented key. */
export function matchesAnyKey(presented: string, configured: readonly string[]): boolean {
  let matched = false;
  for (const key of configured) {
    // Evaluate every key so timing does not reveal *which* key matched.
    if (safeCompare(presented, key)) matched = true;
  }
  return matched;
}
