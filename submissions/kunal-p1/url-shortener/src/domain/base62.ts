/**
 * Base62 short-code generation.
 *
 * - Alphabet is `0-9A-Za-z` (62 symbols) as required by the brief.
 * - Codes are generated with `crypto.randomInt`, which is uniformly distributed
 *   (no modulo bias) and cryptographically strong, so codes are unguessable.
 * - Length defaults to 7 and is configurable within 6-8 characters.
 */

import { randomInt } from 'node:crypto';

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const MIN_CODE_LENGTH = 6;
export const MAX_CODE_LENGTH = 8;
export const DEFAULT_CODE_LENGTH = 7;

/** Number of possible codes for a given length - used for collision probability math. */
export const BASE62_SPACE = BigInt(BASE62_ALPHABET.length);

export class InvalidCodeLengthError extends RangeError {
  constructor(length: number) {
    super(`Code length must be an integer between ${MIN_CODE_LENGTH} and ${MAX_CODE_LENGTH}`);
    this.name = 'InvalidCodeLengthError';
    this.stack = undefined;
    void length;
  }
}

export function assertValidCodeLength(length: number): void {
  if (!Number.isInteger(length) || length < MIN_CODE_LENGTH || length > MAX_CODE_LENGTH) {
    throw new InvalidCodeLengthError(length);
  }
}

/** Generate a random base62 code of `length` characters (6-8). */
export function generateCode(length: number = DEFAULT_CODE_LENGTH): string {
  assertValidCodeLength(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += BASE62_ALPHABET.charAt(randomInt(0, BASE62_ALPHABET.length));
  }
  return code;
}

/** True when `value` is a syntactically valid base62 code in the 6-8 char range. */
export function isBase62Code(value: string): boolean {
  return /^[0-9A-Za-z]{6,8}$/.test(value);
}

/** Total number of codes available for a length, as a plain number (safe up to 8 chars). */
export function codeSpaceSize(length: number): number {
  assertValidCodeLength(length);
  return 62 ** length;
}
