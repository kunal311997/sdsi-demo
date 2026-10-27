import { describe, expect, it } from 'vitest';

import {
  BASE62_ALPHABET,
  InvalidCodeLengthError,
  assertValidCodeLength,
  codeSpaceSize,
  generateCode,
  isBase62Code,
} from '../../src/domain/base62.js';

describe('base62 code generation (M1)', () => {
  it('uses the documented alphabet', () => {
    expect(BASE62_ALPHABET).toHaveLength(62);
    expect(BASE62_ALPHABET).toMatch(/^[0-9A-Za-z]{62}$/);
  });

  it('defaults to 7 characters', () => {
    expect(generateCode()).toHaveLength(7);
  });

  it.each([6, 7, 8])('generates %i-character codes', (length) => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateCode(length);
      expect(code).toHaveLength(length);
      expect(code).toMatch(/^[0-9A-Za-z]+$/);
    }
  });

  it('rejects lengths outside 6-8', () => {
    for (const length of [0, 1, 5, 9, 12, 3.5]) {
      expect(() => generateCode(length)).toThrow(InvalidCodeLengthError);
    }
  });

  it('produces distinct codes (collision sanity over 20k draws)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) seen.add(generateCode(7));
    // Birthday bound for 62^7 is far above 20k draws; duplicates should be absent.
    expect(seen.size).toBe(20_000);
  });

  it('distributes characters roughly uniformly (no modulo bias)', () => {
    const counts = new Map<string, number>();
    const draws = 62 * 400;
    for (let i = 0; i < draws; i += 1) {
      for (const char of generateCode(7)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    const expected = (draws * 7) / 62;
    let maxDeviation = 0;
    for (const char of BASE62_ALPHABET) {
      const observed = counts.get(char) ?? 0;
      expect(observed).toBeGreaterThan(0);
      maxDeviation = Math.max(maxDeviation, Math.abs(observed - expected) / expected);
    }
    // Coarse bound: catches sequential/Math.random mistakes without flakiness.
    expect(maxDeviation).toBeLessThan(0.15);
  });

  it('recognises valid codes', () => {
    expect(isBase62Code('Ab3dE9x')).toBe(true);
    expect(isBase62Code('123456')).toBe(true);
    expect(isBase62Code('')).toBe(false);
    expect(isBase62Code('abc')).toBe(false);
    expect(isBase62Code('abcdefghij')).toBe(false);
    expect(isBase62Code('abc-def')).toBe(false);
    expect(isBase62Code('abc def')).toBe(false);
  });

  it('computes the code space', () => {
    expect(codeSpaceSize(6)).toBe(62 ** 6);
    expect(codeSpaceSize(8)).toBe(62 ** 8);
    expect(() => assertValidCodeLength(5)).toThrow();
  });
});
