import { describe, expect, it } from 'vitest';

import { requestId, REQUEST_ID_HEADER } from '../../src/middleware/requestId.js';
import { extractApiKey } from '../../src/middleware/auth.js';
import { hashIp, matchesAnyKey, safeCompare, truncate } from '../../src/lib/crypto.js';

function fakeReq(headers: Record<string, string | undefined>) {
  return {
    get: (name: string) => headers[name.toLowerCase()],
  };
}

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    locals: {} as Record<string, unknown>,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    headers,
  };
}

describe('requestId middleware', () => {
  it('echoes a safe client id', () => {
    const req = fakeReq({ 'x-request-id': 'abc-123.def:ghi' });
    const res = fakeRes();
    requestId(req as never, res as never, () => {});

    expect(res.headers[REQUEST_ID_HEADER]).toBe('abc-123.def:ghi');
    expect(res.locals.requestId).toBe('abc-123.def:ghi');
  });

  it('replaces ids containing CRLF (header injection)', () => {
    const req = fakeReq({ 'x-request-id': 'evil\r\nx-injected: 1' });
    const res = fakeRes();
    requestId(req as never, res as never, () => {});

    const issued = res.headers[REQUEST_ID_HEADER];
    expect(issued).toBeDefined();
    expect(issued).not.toContain('evil');
    expect(issued).not.toMatch(/[\r\n]/);
  });

  it('replaces over-long ids', () => {
    const req = fakeReq({ 'x-request-id': 'a'.repeat(200) });
    const res = fakeRes();
    requestId(req as never, res as never, () => {});
    expect(res.headers[REQUEST_ID_HEADER]).toHaveLength(36);
  });

  it('generates a UUID when the header is absent', () => {
    const res = fakeRes();
    requestId(fakeReq({}) as never, res as never, () => {});
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('API key extraction', () => {
  it('reads Bearer tokens', () => {
    expect(extractApiKey(fakeReq({ authorization: 'Bearer secret' }) as never)).toBe('secret');
    expect(extractApiKey(fakeReq({ authorization: 'bearer   secret  ' }) as never)).toBe('secret');
  });

  it('reads X-API-Key', () => {
    expect(extractApiKey(fakeReq({ 'x-api-key': ' other ' }) as never)).toBe('other');
  });

  it('returns null for missing or malformed headers', () => {
    expect(extractApiKey(fakeReq({}) as never)).toBeNull();
    expect(extractApiKey(fakeReq({ authorization: 'Basic abc' }) as never)).toBeNull();
    expect(extractApiKey(fakeReq({ authorization: 'Bearer ' }) as never)).toBeNull();
  });
});

describe('crypto helpers', () => {
  it('compares strings in constant time', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('abc', 'abcd')).toBe(false);
  });

  it('matches any configured key', () => {
    expect(matchesAnyKey('b', ['a', 'b'])).toBe(true);
    expect(matchesAnyKey('c', ['a', 'b'])).toBe(false);
    expect(matchesAnyKey('a', [])).toBe(false);
  });

  it('hashes IPs irreversibly and stably', () => {
    const first = hashIp('203.0.113.9', 'salt');
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp('203.0.113.9', 'salt')).toBe(first);
    expect(hashIp('203.0.113.9', 'other-salt')).not.toBe(first);
    expect(first).not.toContain('203.0.113');
  });

  it('collapses IPv4-mapped IPv6 forms', () => {
    expect(hashIp('::ffff:203.0.113.9', 'salt')).toBe(hashIp('203.0.113.9', 'salt'));
  });

  it('returns null for a missing IP', () => {
    expect(hashIp(null, 'salt')).toBeNull();
    expect(hashIp(undefined, 'salt')).toBeNull();
    expect(hashIp('', 'salt')).toBeNull();
  });

  it('truncates long values', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
    expect(truncate('ab', 10)).toBe('ab');
    expect(truncate('   ', 10)).toBeNull();
    expect(truncate(undefined, 10)).toBeNull();
  });
});
