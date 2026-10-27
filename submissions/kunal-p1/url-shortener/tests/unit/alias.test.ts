import { describe, expect, it } from 'vitest';

import { RESERVED_ALIASES, isReservedPath, validateAlias } from '../../src/domain/alias.js';
import { AppError } from '../../src/domain/errors.js';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error('expected an AppError');
}

describe('alias validation', () => {
  it.each(['abc', 'my-link', 'My_Link', 'abc123', 'a'.repeat(32), 'x-y_z'])(
    'accepts %s',
    (alias) => {
      expect(validateAlias(alias)).toBe(alias);
    },
  );

  it.each([
    ['ab'],
    ['a'.repeat(33)],
    [''],
    ['has space'],
    ['has/slash'],
    ['has.dot'],
    ['emoji🎉'],
    ['per%cent'],
  ])('rejects %j', (alias) => {
    expect(code(() => validateAlias(alias))).toBe('INVALID_ALIAS');
  });

  it('rejects non-string input', () => {
    for (const value of [undefined, null, 1, {}, [], true]) {
      expect(code(() => validateAlias(value))).toBe('INVALID_ALIAS');
    }
  });

  it('rejects reserved route names case-insensitively', () => {
    for (const alias of ['stats', 'STATS', 'Stats', 'health', 'links', 'shorten', 'favicon.ico']) {
      expect(code(() => validateAlias(alias))).toBe('ALIAS_RESERVED');
    }
  });

  it('does not reject names that merely contain a reserved word', () => {
    expect(validateAlias('stats-2026')).toBe('stats-2026');
    expect(validateAlias('healthy')).toBe('healthy');
  });

  it('marks reserved paths for routing checks', () => {
    expect(isReservedPath('Health')).toBe(true);
    expect(isReservedPath('my-code')).toBe(false);
    expect(RESERVED_ALIASES.has('api')).toBe(true);
  });

  it('does not allow path traversal or encoding tricks', () => {
    for (const alias of ['..', '../etc', '%2e%2e', 'a\\b', 'a?b', 'a#b']) {
      expect(code(() => validateAlias(alias))).toBe('INVALID_ALIAS');
    }
  });
});
