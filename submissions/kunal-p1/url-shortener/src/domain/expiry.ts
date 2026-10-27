/**
 * Expiry parsing (requirement M1).
 *
 * Rules chosen for unambiguous, timezone-safe behaviour:
 * - ISO-8601 date-time with an explicit zone: `2026-01-01T00:00:00Z` or
 *   `2026-01-01T05:30:00+05:30`. Zone-less strings and date-only strings are
 *   rejected instead of being silently interpreted in server-local time.
 * - Must be strictly in the future.
 * - Bounded horizon (default 10 years) so typos like year 9999 fail loudly.
 */

import { AppError } from './errors.js';

const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const MS_PER_DAY = 86_400_000;

/**
 * True when `YYYY-MM-DD` names a real calendar day.
 *
 * `Date.parse` silently rolls invalid days forward (`2026-02-30` becomes
 * 2 March), which would accept a typo as a valid expiry, so the calendar part is
 * validated explicitly before parsing.
 */
function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Day 0 of the next month is the last day of this month (UTC).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * @param raw   client supplied ISO-8601 timestamp
 * @param now   current epoch milliseconds (injected clock for testability)
 * @param maxDays maximum allowed horizon in days
 * @returns epoch milliseconds
 * @throws {AppError} INVALID_EXPIRY / EXPIRY_IN_PAST / EXPIRY_TOO_FAR
 */
export function parseExpiresAt(raw: unknown, now: number, maxDays: number): number {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('INVALID_EXPIRY', '`expiresAt` must be an ISO-8601 date-time string', {
      field: 'expiresAt',
    });
  }
  if (!ISO_WITH_ZONE.test(raw) || !isValidCalendarDate(raw)) {
    throw new AppError(
      'INVALID_EXPIRY',
      '`expiresAt` must be ISO-8601 with an explicit timezone, e.g. 2026-12-31T23:59:59Z',
      { field: 'expiresAt' },
    );
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new AppError('INVALID_EXPIRY', '`expiresAt` is not a valid date-time', {
      field: 'expiresAt',
    });
  }

  if (parsed <= now) {
    throw new AppError('EXPIRY_IN_PAST', '`expiresAt` must be in the future', {
      field: 'expiresAt',
    });
  }

  const maxHorizon = now + maxDays * MS_PER_DAY;
  if (parsed > maxHorizon) {
    throw new AppError('EXPIRY_TOO_FAR', `\`expiresAt\` must be within ${maxDays} days`, {
      field: 'expiresAt',
      maxDays,
    });
  }

  return parsed;
}

/** ISO string for an epoch-millisecond timestamp (UTC), or null. */
export function toIso(timestamp: number | null | undefined): string | null {
  if (timestamp === null || timestamp === undefined) return null;
  return new Date(timestamp).toISOString();
}

/** UTC calendar date (`YYYY-MM-DD`) for an epoch-millisecond timestamp. */
export function toUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
