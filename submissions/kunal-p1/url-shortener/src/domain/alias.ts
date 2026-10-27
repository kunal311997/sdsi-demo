/**
 * Custom alias validation.
 *
 * Aliases share the same namespace as generated codes, so:
 * - the character set is restricted (no slashes, dots, percent-escapes or
 *   control characters -> no path traversal, no encoding surprises),
 * - reserved route names are blocked case-insensitively, so an alias can never
 *   shadow `/stats`, `/health` or a static asset,
 * - length is bounded to keep URLs readable and avoid index bloat.
 */

import { AppError } from './errors.js';

export const MIN_ALIAS_LENGTH = 3;
export const MAX_ALIAS_LENGTH = 32;
const ALIAS_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Route names, static files and other reserved words. Compared lowercased, so
 * `Stats`, `STATS` and `stats` are all rejected.
 */
export const RESERVED_ALIASES: ReadonlySet<string> = new Set([
  'shorten',
  'stats',
  'links',
  'health',
  'healthz',
  'ready',
  'live',
  'api',
  'dashboard',
  'admin',
  'public',
  'static',
  'assets',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'index.html',
  'metrics',
  'prune',
  'login',
  'logout',
  'signup',
  'well-known',
  'internal',
  'system',
  'root',
]);

/**
 * Validate a custom alias and return it unchanged.
 *
 * Order matters: length, then reserved names, then the character set. Reserved
 * names are checked before the pattern so `favicon.ico` (reserved, but contains a
 * dot) reports the more specific `ALIAS_RESERVED` rather than `INVALID_ALIAS`.
 *
 * @throws {AppError} INVALID_ALIAS / ALIAS_RESERVED (both 400).
 */
export function validateAlias(alias: unknown): string {
  if (typeof alias !== 'string') {
    throw new AppError('INVALID_ALIAS', '`alias` must be a string', { field: 'alias' });
  }
  if (alias.length < MIN_ALIAS_LENGTH || alias.length > MAX_ALIAS_LENGTH) {
    throw new AppError(
      'INVALID_ALIAS',
      `Alias must be between ${MIN_ALIAS_LENGTH} and ${MAX_ALIAS_LENGTH} characters`,
      { field: 'alias', minLength: MIN_ALIAS_LENGTH, maxLength: MAX_ALIAS_LENGTH },
    );
  }
  if (RESERVED_ALIASES.has(alias.toLowerCase())) {
    throw new AppError('ALIAS_RESERVED', 'Alias is reserved by the application', {
      field: 'alias',
      alias,
    });
  }
  if (!ALIAS_PATTERN.test(alias)) {
    throw new AppError(
      'INVALID_ALIAS',
      'Alias may only contain letters, digits, underscores and hyphens',
      { field: 'alias' },
    );
  }
  return alias;
}

/** True when a code cannot be routed because it collides with a reserved path. */
export function isReservedPath(value: string): boolean {
  return RESERVED_ALIASES.has(value.toLowerCase());
}
