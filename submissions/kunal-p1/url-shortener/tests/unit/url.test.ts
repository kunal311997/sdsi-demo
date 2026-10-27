import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/domain/errors.js';
import { isPrivateHostname } from '../../src/domain/net.js';
import { normalizeUrl } from '../../src/domain/url.js';

const options = {
  maxUrlLength: 2048,
  allowPrivateHosts: false,
  selfOrigins: ['http://short.test'],
};

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError with code ${code}`);
}

describe('URL validation (M3)', () => {
  it('accepts http and https URLs', () => {
    expect(normalizeUrl('https://example.com/path', options).url).toBe('https://example.com/path');
    expect(normalizeUrl('http://example.com', options).url).toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1) ',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'blob:https://example.com/abc',
    'about:blank',
    'ftp://example.com/file.txt',
    'ws://example.com/socket',
  ])('rejects non-http(s) scheme %s', (input) => {
    expectCode(() => normalizeUrl(input, options), 'UNSUPPORTED_SCHEME');
  });

  it.each([
    ['', 'INVALID_URL'],
    ['   ', 'INVALID_URL'],
    ['not a url', 'INVALID_URL'],
    ['example.com', 'INVALID_URL'],
    ['http://', 'INVALID_URL'],
    ['//example.com/path', 'INVALID_URL'],
    ['http://exa mple.com', 'INVALID_URL'],
    ['http://example.com/\r\nSet-Cookie: x=1', 'INVALID_URL'],
    ['http://example.com/\u0000', 'INVALID_URL'],
    // WHATWG URL treats the third slash as the host, which lands as a single-label host.
    ['https:///path', 'BLOCKED_HOST'],
  ])('rejects malformed input %j', (input, code) => {
    expectCode(() => normalizeUrl(input, options), code);
  });

  it('rejects embedded credentials', () => {
    expectCode(() => normalizeUrl('https://user:pass@example.com', options), 'URL_HAS_CREDENTIALS');
    expectCode(() => normalizeUrl('https://user@example.com', options), 'URL_HAS_CREDENTIALS');
  });

  it('rejects non-string input', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expectCode(() => normalizeUrl(value, options), 'VALIDATION_ERROR');
    }
  });

  it('enforces the length limit before and after normalisation', () => {
    const longUrl = `https://example.com/${'a'.repeat(2100)}`;
    expectCode(() => normalizeUrl(longUrl, options), 'URL_TOO_LONG');
  });

  it('rejects control characters and backslashes', () => {
    expectCode(() => normalizeUrl('https://example.com/\u0001', options), 'INVALID_URL');
    expectCode(() => normalizeUrl('https://example.com\\@evil.com', options), 'INVALID_URL');
  });

  it('rejects zero-width and bidi characters', () => {
    expectCode(() => normalizeUrl('https://exa\u200Bmple.com', options), 'INVALID_URL');
    expectCode(() => normalizeUrl('https://example.com/\u202Egnp.exe', options), 'INVALID_URL');
  });

  it('rejects invalid host labels', () => {
    expectCode(() => normalizeUrl('https://-leading.example.com', options), 'INVALID_URL');
    expectCode(() => normalizeUrl('https://trailing-.example.com', options), 'INVALID_URL');
    expectCode(() => normalizeUrl('https://exa_mple.com', options), 'INVALID_URL');
  });

  it('accepts punycode/unicode hosts via URL parsing', () => {
    const result = normalizeUrl('https://bücher.example/path', options);
    expect(result.url).toBe('https://xn--bcher-kva.example/path');
  });

  it('normalises for idempotency (M4)', () => {
    const variants = [
      'https://Example.com/path',
      'https://example.com/path',
      'https://example.com:443/path',
      'https://example.com/path',
    ];
    const hashes = variants.map((url) => normalizeUrl(url, options).hash);
    expect(new Set(hashes).size).toBe(1);
  });

  it('keeps path, query and fragment case distinct', () => {
    const a = normalizeUrl('https://example.com/Path?A=1#Frag', options);
    const b = normalizeUrl('https://example.com/path?a=1#frag', options);
    expect(a.hash).not.toBe(b.hash);
  });

  it('normalises a trailing root dot', () => {
    const a = normalizeUrl('https://example.com./x', options);
    const b = normalizeUrl('https://example.com/x', options);
    expect(a.url).toBe(b.url);
  });

  it('blocks private, loopback and metadata hosts', () => {
    const blocked = [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://127.1',
      'http://0.0.0.0',
      'http://10.0.0.1',
      'http://172.16.5.4',
      'http://192.168.1.1',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://service.internal',
      'http://printer.local',
      'http://intranet',
      'http://2130706433/',
      'http://0x7f.1/',
    ];
    for (const url of blocked) {
      expectCode(() => normalizeUrl(url, options), 'BLOCKED_HOST');
    }
  });

  it('allows private hosts when explicitly enabled', () => {
    const permissive = { ...options, allowPrivateHosts: true };
    expect(normalizeUrl('http://localhost:3000/x', permissive).url).toBe('http://localhost:3000/x');
    expect(normalizeUrl('http://10.0.0.1/x', permissive).url).toBe('http://10.0.0.1/x');
  });

  it('rejects self-references', () => {
    expectCode(() => normalizeUrl('http://short.test/abc123', options), 'SELF_REFERENCE');
  });

  it('produces a stable sha256 hash', () => {
    const result = normalizeUrl('https://example.com/x', options);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.hash).toBe(normalizeUrl('HTTPS://EXAMPLE.COM/x', options).hash);
  });
});

describe('isPrivateHostname', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.31.255.255', true],
    ['192.168.0.1', true],
    ['169.254.1.1', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['0.0.0.0', true],
    ['255.255.255.255', true],
    ['example.com', false],
    ['8.8.8.8', false],
    ['sub.example.co.uk', false],
  ])('%s -> %s', (host, expected) => {
    expect(isPrivateHostname(host)).toBe(expected);
  });

  it('fails closed on unparseable hosts', () => {
    expect(isPrivateHostname('')).toBe(true);
    expect(isPrivateHostname('exa_mple.com')).toBe(false); // valid public label shape, DNS-level concern
  });
});
