import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/domain/errors.js';
import { parseExpiresAt, toIso, toUtcDate } from '../../src/domain/expiry.js';

const NOW = Date.parse('2026-01-15T10:00:00.000Z');
const MAX_DAYS = 3650;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error('expected an AppError');
}

describe('expiry parsing', () => {
  it('accepts Z-suffixed timestamps in the future', () => {
    const value = parseExpiresAt('2026-02-01T00:00:00Z', NOW, MAX_DAYS);
    expect(value).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('accepts offset timestamps', () => {
    expect(parseExpiresAt('2026-02-01T05:30:00+05:30', NOW, MAX_DAYS)).toBe(
      Date.parse('2026-02-01T00:00:00Z'),
    );
    expect(parseExpiresAt('2026-01-31T20:00:00-04:00', NOW, MAX_DAYS)).toBe(
      Date.parse('2026-02-01T00:00:00Z'),
    );
  });

  it('accepts fractional seconds', () => {
    expect(parseExpiresAt('2026-02-01T00:00:00.250Z', NOW, MAX_DAYS)).toBe(
      Date.parse('2026-02-01T00:00:00.250Z'),
    );
  });

  it.each([
    '2026-02-01',
    '2026-02-01T00:00:00',
    '01/02/2026',
    'tomorrow',
    '2026-13-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '',
  ])('rejects %j', (input) => {
    expect(codeOf(() => parseExpiresAt(input, NOW, MAX_DAYS))).toBe('INVALID_EXPIRY');
  });

  it('rejects non-string input', () => {
    for (const value of [undefined, null, 123, {}, []]) {
      expect(codeOf(() => parseExpiresAt(value, NOW, MAX_DAYS))).toBe('INVALID_EXPIRY');
    }
  });

  it('rejects past and exactly-now timestamps', () => {
    expect(codeOf(() => parseExpiresAt('2026-01-15T09:59:59Z', NOW, MAX_DAYS))).toBe(
      'EXPIRY_IN_PAST',
    );
    expect(codeOf(() => parseExpiresAt('2026-01-15T10:00:00Z', NOW, MAX_DAYS))).toBe(
      'EXPIRY_IN_PAST',
    );
  });

  it('rejects timestamps beyond the configured horizon', () => {
    expect(codeOf(() => parseExpiresAt('2046-01-15T10:00:01Z', NOW, MAX_DAYS))).toBe(
      'EXPIRY_TOO_FAR',
    );
  });

  it('formats timestamps as ISO UTC', () => {
    expect(toIso(NOW)).toBe('2026-01-15T10:00:00.000Z');
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });

  it('buckets by UTC date', () => {
    expect(toUtcDate(Date.parse('2026-01-15T23:59:59Z'))).toBe('2026-01-15');
    expect(toUtcDate(Date.parse('2026-01-16T00:00:00Z'))).toBe('2026-01-16');
  });
});
