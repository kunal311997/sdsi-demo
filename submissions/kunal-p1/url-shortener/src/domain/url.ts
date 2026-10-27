/**
 * URL validation and canonicalisation (requirement M3).
 *
 * Accepted: absolute http/https URLs only.
 * Rejected: every other scheme (`javascript:`, `data:`, `file:`, `vbscript:`,
 * `blob:`, `about:`, ...), malformed URLs, embedded credentials, control/
 * zero-width characters, backslashes, over-long input, private/loopback hosts
 * and self-references back to the shortener.
 *
 * Canonicalisation is what makes shortening idempotent (requirement M4):
 * scheme/host case, default ports and empty paths are normalised before the
 * SHA-256 dedupe hash is computed, while path/query/fragment case is preserved.
 */

import { createHash } from 'node:crypto';

import { AppError } from './errors.js';
import { isPrivateHostname } from './net.js';

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

// Control characters plus invisible/bidi characters used to smuggle past filters:
// C0/C1 controls, zero-width space/joiners, bidi marks and overrides, BOM.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export interface NormalizeOptions {
  maxUrlLength: number;
  allowPrivateHosts: boolean;
  /** Origins of the shortener itself; targets matching them are rejected. */
  selfOrigins?: readonly string[];
}

export interface NormalizedUrl {
  /** Canonical serialisation, safe to store and redirect to. */
  url: string;
  /** SHA-256 of `url`, used for idempotent shortening. */
  hash: string;
  hostname: string;
  protocol: 'http:' | 'https:';
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateHostname(hostname: string): void {
  if (hostname.length === 0) {
    throw new AppError('INVALID_URL', 'URL must include a host', { field: 'url' });
  }

  // IPv6 literals from URL#hostname keep their brackets.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return;

  if (hostname.length > 253) {
    throw new AppError('INVALID_URL', 'Host name is too long (max 253 characters)', {
      field: 'url',
    });
  }

  const labels = hostname.replace(/\.$/, '').split('.');
  for (const label of labels) {
    if (!DOMAIN_LABEL.test(label)) {
      throw new AppError('INVALID_URL', 'Host name contains an invalid label', {
        field: 'url',
        label,
      });
    }
  }
}

/**
 * Validate and canonicalise a user-supplied URL.
 * @throws {AppError} with a 400-family code when the URL is unusable.
 */
export function normalizeUrl(raw: unknown, options: NormalizeOptions): NormalizedUrl {
  if (typeof raw !== 'string') {
    throw new AppError('VALIDATION_ERROR', '`url` must be a string', { field: 'url' });
  }

  // Tolerate accidental surrounding whitespace from copy/paste; everything
  // else (including CRLF in the middle) is rejected outright.
  const candidate = raw.trim();
  if (candidate.length === 0) {
    throw new AppError('INVALID_URL', 'URL must not be empty', { field: 'url' });
  }
  if (candidate.length > options.maxUrlLength) {
    throw new AppError('URL_TOO_LONG', `URL must be at most ${options.maxUrlLength} characters`, {
      field: 'url',
      maxLength: options.maxUrlLength,
    });
  }
  if (FORBIDDEN_CHARS.test(candidate)) {
    throw new AppError('INVALID_URL', 'URL must not contain control or invisible characters', {
      field: 'url',
    });
  }
  if (candidate.includes('\\')) {
    throw new AppError('INVALID_URL', 'URL must not contain backslashes', { field: 'url' });
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AppError('INVALID_URL', 'URL is malformed', { field: 'url' });
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new AppError('UNSUPPORTED_SCHEME', 'Only http:// and https:// URLs are supported', {
      field: 'url',
      scheme: parsed.protocol.replace(':', ''),
    });
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new AppError('URL_HAS_CREDENTIALS', 'URL must not embed credentials', { field: 'url' });
  }

  if (parsed.hostname === '') {
    throw new AppError('INVALID_URL', 'URL must include a host', { field: 'url' });
  }

  validateHostname(parsed.hostname);

  // Normalise a trailing root dot so `example.com.` and `example.com` dedupe.
  if (parsed.hostname.endsWith('.')) {
    parsed.hostname = parsed.hostname.replace(/\.+$/, '');
  }

  if (!options.allowPrivateHosts) {
    if (isPrivateHostname(parsed.hostname)) {
      throw new AppError('BLOCKED_HOST', 'URL host is not a publicly routable address', {
        field: 'url',
        host: parsed.hostname.replace(/^\[|\]$/g, ''),
      });
    }
  }

  // `URL` already drops default ports, lowercases scheme/host and adds "/" for
  // an empty path; re-serialising gives us a stable canonical form.
  const canonical = parsed.toString();
  if (canonical.length > options.maxUrlLength) {
    throw new AppError(
      'URL_TOO_LONG',
      `URL must be at most ${options.maxUrlLength} characters after normalisation`,
      { field: 'url', maxLength: options.maxUrlLength },
    );
  }

  const canonicalOrigin = parsed.origin;
  for (const selfOrigin of options.selfOrigins ?? []) {
    if (canonicalOrigin === selfOrigin) {
      throw new AppError('SELF_REFERENCE', 'URL points back at the shortener itself', {
        field: 'url',
        host: parsed.hostname,
      });
    }
  }

  return {
    url: canonical,
    hash: sha256(canonical),
    hostname: parsed.hostname,
    protocol: parsed.protocol as 'http:' | 'https:',
  };
}

/** True when the URL's port is the default for its scheme (exposed for tests). */
export function hasDefaultPort(url: URL): boolean {
  return DEFAULT_PORTS[url.protocol] === url.port;
}
