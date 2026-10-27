import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestContext, type TestContext } from '../helpers/testContext.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  ctx.cleanup();
});

describe('M1: shorten a URL', () => {
  it('creates a 6-8 character base62 code', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/article' })
      .expect(201);

    expect(response.body.code).toMatch(/^[0-9A-Za-z]{6,8}$/);
    expect(response.body.shortUrl).toBe(`http://short.test/${response.body.code}`);
    expect(response.body.targetUrl).toBe('https://example.com/article');
    expect(response.body.created).toBe(true);
    expect(response.body.isCustomAlias).toBe(false);
    expect(response.body.expiresAt).toBeNull();
    expect(response.body.createdAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('honours CODE_LENGTH=8', async () => {
    const custom = createTestContext({ env: { CODE_LENGTH: '8' } });
    try {
      const response = await request(custom.app)
        .post('/shorten')
        .send({ url: 'https://example.com/eight' })
        .expect(201);
      expect(response.body.code).toHaveLength(8);
    } finally {
      custom.cleanup();
    }
  });

  it('accepts a custom alias', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/promo', alias: 'Launch-2026' })
      .expect(201);

    expect(response.body.code).toBe('Launch-2026');
    expect(response.body.isCustomAlias).toBe(true);
    expect(response.body.shortUrl).toBe('http://short.test/Launch-2026');
  });

  it('accepts an expiry timestamp', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/limited', expiresAt: '2026-02-01T00:00:00Z' })
      .expect(201);

    expect(response.body.expiresAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('requires a JSON content type', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .set('Content-Type', 'text/plain')
      .send('https://example.com')
      .expect(415);

    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an empty body with a validation error', async () => {
    const response = await request(ctx.app).post('/shorten').send({}).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.issues).toBeDefined();
  });

  it('rejects unknown body fields', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com', sneaky: true })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .set('Content-Type', 'application/json')
      .send('{"url":')
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 405 for GET /shorten', async () => {
    const response = await request(ctx.app).get('/shorten').expect(405);
    expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(response.headers.allow).toBe('POST');
  });
});

describe('M3: URL validation over HTTP', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ])('rejects %s with UNSUPPORTED_SCHEME', async (url) => {
    const response = await request(ctx.app).post('/shorten').send({ url }).expect(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_SCHEME');
  });

  it('rejects malformed URLs', async () => {
    const response = await request(ctx.app).post('/shorten').send({ url: 'not-a-url' }).expect(400);
    expect(response.body.error.code).toBe('INVALID_URL');
  });

  it('rejects private targets by default', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'http://169.254.169.254/latest/meta-data' })
      .expect(400);
    expect(response.body.error.code).toBe('BLOCKED_HOST');
  });

  it('allows private targets when configured', async () => {
    const permissive = createTestContext({ env: { ALLOW_PRIVATE_HOSTS: 'true' } });
    try {
      await request(permissive.app)
        .post('/shorten')
        .send({ url: 'http://localhost:8080/internal' })
        .expect(201);
    } finally {
      permissive.cleanup();
    }
  });

  it('rejects a self-referencing URL', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'http://short.test/abc123' })
      .expect(400);
    expect(response.body.error.code).toBe('SELF_REFERENCE');
  });

  it('rejects a reserved alias', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com', alias: 'stats' })
      .expect(400);
    expect(response.body.error.code).toBe('ALIAS_RESERVED');
  });

  it('rejects a past expiry', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com', expiresAt: '2020-01-01T00:00:00Z' })
      .expect(400);
    expect(response.body.error.code).toBe('EXPIRY_IN_PAST');
  });

  it('rejects a zone-less expiry', async () => {
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com', expiresAt: '2026-02-01T00:00:00' })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_EXPIRY');
  });
});

describe('M4: idempotent shortening', () => {
  it('returns the same code for the same URL', async () => {
    const first = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/same' })
      .expect(201);
    const second = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/same' })
      .expect(200);

    expect(second.body.code).toBe(first.body.code);
    expect(second.body.created).toBe(false);
  });

  it('normalises before comparing', async () => {
    const first = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://Example.com:443/path' })
      .expect(201);
    const second = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/path' })
      .expect(200);
    expect(second.body.code).toBe(first.body.code);
  });

  it('treats different paths as different links', async () => {
    const first = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/a' })
      .expect(201);
    const second = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/b' })
      .expect(201);
    expect(second.body.code).not.toBe(first.body.code);
  });

  it('does not reuse codes for alias requests', async () => {
    const generated = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/alias-test' })
      .expect(201);
    const aliased = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/alias-test', alias: 'my-alias' })
      .expect(201);

    expect(aliased.body.code).toBe('my-alias');
    expect(aliased.body.code).not.toBe(generated.body.code);
  });

  it('returns 200 for the identical alias + URL pair', async () => {
    const first = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/promo', alias: 'promo-2026' })
      .expect(201);
    const second = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/promo', alias: 'promo-2026' })
      .expect(200);

    expect(second.body.code).toBe(first.body.code);
    expect(second.body.created).toBe(false);
  });

  it('returns 409 when the alias is used for a different URL', async () => {
    await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/one', alias: 'shared' })
      .expect(201);
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/two', alias: 'shared' })
      .expect(409);

    expect(response.body.error.code).toBe('ALIAS_TAKEN');
  });

  it('mints a new code when the previous link expired', async () => {
    const first = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/renew', expiresAt: '2026-01-20T00:00:00Z' })
      .expect(201);

    // Jump past the expiry.
    ctx.clock.set(Date.parse('2026-01-21T00:00:00Z'));

    const second = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/renew' })
      .expect(201);

    expect(second.body.code).not.toBe(first.body.code);
    // The old code stays gone rather than being resurrected.
    await request(ctx.app).get(`/${first.body.code}`).expect(410);
  });

  it('keeps a single code under concurrent identical requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(ctx.app).post('/shorten').send({ url: 'https://example.com/race' }),
      ),
    );

    const codes = new Set(responses.map((response) => response.body.code));
    expect(codes.size).toBe(1);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(19);
  });

  it('allows exactly one winner under concurrent alias claims', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request(ctx.app)
          .post('/shorten')
          .send({ url: `https://example.com/target-${index}`, alias: 'contested' }),
      ),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(9);
  });
});

describe('M2: resolving codes', () => {
  it('redirects with 302 and no-store caching', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/go' })
      .expect(201);

    const response = await request(ctx.app).get(`/${created.body.code}`).expect(302);
    expect(response.headers.location).toBe('https://example.com/go');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('answers HEAD without recording a click', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/head' })
      .expect(201);

    await request(ctx.app).head(`/${created.body.code}`).expect(302);
    await request(ctx.app).head(`/${created.body.code}`).expect(302);

    const stats = await request(ctx.app).get(`/stats/${created.body.code}`).expect(200);
    expect(stats.body.totalClicks).toBe(0);
  });

  it('returns 404 for unknown codes', async () => {
    const response = await request(ctx.app).get('/doesNotExist').expect(404);
    expect(response.body.error.code).toBe('LINK_NOT_FOUND');
  });

  it('returns 410 for expired codes with the expiry time', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/soon', expiresAt: '2026-01-16T00:00:00Z' })
      .expect(201);

    ctx.clock.set(Date.parse('2026-01-16T00:00:01Z'));

    const response = await request(ctx.app).get(`/${created.body.code}`).expect(410);
    expect(response.body.error.code).toBe('LINK_GONE');
    expect(response.body.error.details.expiredAt).toBe('2026-01-16T00:00:00.000Z');
  });

  it('treats the exact expiry instant as expired', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/edge', expiresAt: '2026-01-16T00:00:00Z' })
      .expect(201);

    ctx.clock.set(Date.parse('2026-01-16T00:00:00Z'));
    await request(ctx.app).get(`/${created.body.code}`).expect(410);
  });

  it('is case sensitive: codes are matched exactly', async () => {
    await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/case', alias: 'CaseAlias' })
      .expect(201);

    await request(ctx.app).get('/CaseAlias').expect(302);
    await request(ctx.app).get('/casealias').expect(404);
  });

  it('returns 302 for an alias route that looks reserved but is longer', async () => {
    await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/x', alias: 'stats2' })
      .expect(201);
    await request(ctx.app).get('/stats2').expect(302);
  });

  it('rejects unsafe verbs on a code', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/v' })
      .expect(201);
    const response = await request(ctx.app).put(`/${created.body.code}`).expect(405);
    expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(ctx.app).get('/stats/x/y/z').expect(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('M5: click analytics', () => {
  it('counts clicks, buckets by UTC day and tracks last access', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/track' })
      .expect(201);
    const code = created.body.code as string;

    await request(ctx.app).get(`/${code}`).expect(302);
    await request(ctx.app).get(`/${code}`).expect(302);

    ctx.clock.set(Date.parse('2026-01-17T08:00:00Z'));
    await request(ctx.app).get(`/${code}`).expect(302);

    const stats = await request(ctx.app).get(`/stats/${code}`).expect(200);
    expect(stats.body.totalClicks).toBe(3);
    expect(stats.body.lastAccessedAt).toBe('2026-01-17T08:00:00.000Z');
    expect(stats.body.firstAccessedAt).toBe('2026-01-15T10:00:00.000Z');

    const byDate = Object.fromEntries(
      (stats.body.clicksPerDay as Array<{ date: string; clicks: number }>).map((point) => [
        point.date,
        point.clicks,
      ]),
    );
    expect(byDate['2026-01-15']).toBe(2);
    expect(byDate['2026-01-16']).toBe(0);
    expect(byDate['2026-01-17']).toBe(1);
  });

  it('counts unique visitors by hashed IP', async () => {
    // Trust the proxy header so the test can impersonate two distinct clients.
    const proxied = createTestContext({ env: { TRUST_PROXY: 'true' } });
    try {
      const created = await request(proxied.app)
        .post('/shorten')
        .send({ url: 'https://example.com/unique' })
        .expect(201);
      const code = created.body.code as string;

      await request(proxied.app).get(`/${code}`).set('X-Forwarded-For', '203.0.113.7').expect(302);
      await request(proxied.app).get(`/${code}`).set('X-Forwarded-For', '203.0.113.7').expect(302);
      await request(proxied.app).get(`/${code}`).set('X-Forwarded-For', '198.51.100.9').expect(302);

      const stats = await request(proxied.app).get(`/stats/${code}`).expect(200);
      expect(stats.body.totalClicks).toBe(3);
      expect(stats.body.uniqueVisitors).toBe(2);
    } finally {
      proxied.cleanup();
    }
  });

  it('treats untrusted clients as a single visitor when TRUST_PROXY is off', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/no-proxy' })
      .expect(201);
    const code = created.body.code as string;

    await request(ctx.app).get(`/${code}`).set('X-Forwarded-For', '203.0.113.7').expect(302);
    await request(ctx.app).get(`/${code}`).set('X-Forwarded-For', '198.51.100.9').expect(302);

    // The spoofable header must be ignored, so both hits share the socket IP.
    const stats = await request(ctx.app).get(`/stats/${code}`).expect(200);
    expect(stats.body.totalClicks).toBe(2);
    expect(stats.body.uniqueVisitors).toBe(1);
  });

  it('returns zeroed stats for a link with no clicks', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/none' })
      .expect(201);
    const stats = await request(ctx.app).get(`/stats/${created.body.code}`).expect(200);

    expect(stats.body.totalClicks).toBe(0);
    expect(stats.body.uniqueVisitors).toBe(0);
    expect(stats.body.lastAccessedAt).toBeNull();
    expect(stats.body.clicksPerDay).toHaveLength(1);
  });

  it('returns 404 for stats of an unknown code', async () => {
    const response = await request(ctx.app).get('/stats/unknown1').expect(404);
    expect(response.body.error.code).toBe('LINK_NOT_FOUND');
  });

  it('keeps stats readable after the link expires', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/legacy', expiresAt: '2026-01-16T00:00:00Z' })
      .expect(201);
    const code = created.body.code as string;
    await request(ctx.app).get(`/${code}`).expect(302);

    ctx.clock.set(Date.parse('2026-02-01T00:00:00Z'));

    const stats = await request(ctx.app).get(`/stats/${code}`).expect(200);
    expect(stats.body.expired).toBe(true);
    expect(stats.body.totalClicks).toBe(1);
  });

  it('lists recent clicks newest first, without exposing raw IPs', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/recent' })
      .expect(201);
    const code = created.body.code as string;

    await request(ctx.app).get(`/${code}`).set('User-Agent', 'first-agent').expect(302);
    ctx.clock.advance(1_000);
    await request(ctx.app).get(`/${code}`).set('User-Agent', 'second-agent').expect(302);

    const response = await request(ctx.app).get(`/stats/${code}/clicks`).expect(200);
    expect(response.body.clicks).toHaveLength(2);
    expect(response.body.clicks[0].userAgent).toBe('second-agent');
    expect(response.body.clicks[0]).not.toHaveProperty('ip');
    expect(response.body.clicks[0]).not.toHaveProperty('ipHash');
  });

  it('stores only hashed IPs in the database', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/hash' })
      .expect(201);
    await request(ctx.app)
      .get(`/${created.body.code}`)
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(302);

    const rows = ctx.db.prepare('SELECT ip_hash FROM clicks').all() as Array<{
      ip_hash: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(rows[0]?.ip_hash).not.toContain('203.0.113');
  });
});

describe('link management', () => {
  it('soft-deletes a link so it returns 410 but keeps stats', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/del' })
      .expect(201);
    const code = created.body.code as string;

    await request(ctx.app).get(`/${code}`).expect(302);
    await request(ctx.app).delete(`/${code}`).expect(200);

    const gone = await request(ctx.app).get(`/${code}`).expect(410);
    expect(gone.body.error.code).toBe('LINK_GONE');

    const stats = await request(ctx.app).get(`/stats/${code}`).expect(200);
    expect(stats.body.deletedAt).toBe('2026-01-15T10:00:00.000Z');
    expect(stats.body.totalClicks).toBe(1);
  });

  it('is idempotent when deleting twice', async () => {
    const created = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/del2' })
      .expect(201);
    await request(ctx.app).delete(`/${created.body.code}`).expect(200);
    await request(ctx.app).delete(`/${created.body.code}`).expect(200);
  });

  it('returns 404 when deleting an unknown code', async () => {
    await request(ctx.app).delete('/neverExisted').expect(404);
  });

  it('lists links newest first with pagination', async () => {
    for (let index = 0; index < 5; index += 1) {
      ctx.clock.advance(1_000);
      await request(ctx.app)
        .post('/shorten')
        .send({ url: `https://example.com/p/${index}` })
        .expect(201);
    }

    const firstPage = await request(ctx.app).get('/links?limit=2&offset=0').expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.total).toBe(5);
    expect(firstPage.body.items[0].targetUrl ?? firstPage.body.items[0].url).toBe(
      'https://example.com/p/4',
    );

    const secondPage = await request(ctx.app).get('/links?limit=2&offset=2').expect(200);
    expect(secondPage.body.items[0].url).toBe('https://example.com/p/2');
  });

  it('clamps pagination parameters', async () => {
    const response = await request(ctx.app).get('/links?limit=9999&offset=-5').expect(200);
    expect(response.body.limit).toBe(100);
    expect(response.body.offset).toBe(0);
  });
});

describe('health and headers', () => {
  it('reports health without caching', async () => {
    const response = await request(ctx.app).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.schemaVersion).toBeGreaterThan(0);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('sets security headers', async () => {
    const response = await request(ctx.app).get('/health').expect(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a safe request id', async () => {
    const echoed = await request(ctx.app).get('/health').set('x-request-id', 'abc-123').expect(200);
    expect(echoed.headers['x-request-id']).toBe('abc-123');
  });

  it('generates a request id when the client sends none', async () => {
    const response = await request(ctx.app).get('/health').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('includes the request id in error bodies', async () => {
    const response = await request(ctx.app)
      .get('/nope123')
      .set('x-request-id', 'trace-me')
      .expect(404);
    expect(response.body.error.requestId).toBe('trace-me');
  });
});
