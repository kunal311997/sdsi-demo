import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestContext, type TestContext } from '../helpers/testContext.js';

let ctx: TestContext | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

describe('authentication', () => {
  it('allows anonymous writes when no keys are configured (development)', async () => {
    ctx = createTestContext({ env: { API_KEYS: '' } });
    await request(ctx.app).post('/shorten').send({ url: 'https://example.com/a' }).expect(201);
  });

  it('requires a key for writes when configured', async () => {
    ctx = createTestContext({ env: { API_KEYS: 'secret-1,secret-2' } });

    const missing = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/a' })
      .expect(401);
    expect(missing.body.error.code).toBe('UNAUTHORIZED');

    const wrong = await request(ctx.app)
      .post('/shorten')
      .set('Authorization', 'Bearer nope')
      .send({ url: 'https://example.com/a' })
      .expect(401);
    expect(wrong.body.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts Bearer tokens and X-API-Key headers', async () => {
    ctx = createTestContext({ env: { API_KEYS: 'secret-1,secret-2' } });

    await request(ctx.app)
      .post('/shorten')
      .set('Authorization', 'Bearer secret-1')
      .send({ url: 'https://example.com/b1' })
      .expect(201);

    await request(ctx.app)
      .post('/shorten')
      .set('x-api-key', 'secret-2')
      .send({ url: 'https://example.com/b2' })
      .expect(201);
  });

  it('is case-insensitive on the Bearer scheme', async () => {
    ctx = createTestContext({ env: { API_KEYS: 'secret-1' } });
    await request(ctx.app)
      .post('/shorten')
      .set('Authorization', 'bearer secret-1')
      .send({ url: 'https://example.com/case' })
      .expect(201);
  });

  it('protects deletes and listing, but keeps redirects public', async () => {
    ctx = createTestContext({ env: { API_KEYS: 'secret-1' } });

    const created = await request(ctx.app)
      .post('/shorten')
      .set('Authorization', 'Bearer secret-1')
      .send({ url: 'https://example.com/protected' })
      .expect(201);

    await request(ctx.app).get(`/${created.body.code}`).expect(302);
    await request(ctx.app).get('/links').expect(401);
    await request(ctx.app).delete(`/${created.body.code}`).expect(401);

    await request(ctx.app)
      .delete(`/${created.body.code}`)
      .set('Authorization', 'Bearer secret-1')
      .expect(200);
  });

  it('keeps stats public by default but respects STATS_REQUIRE_AUTH', async () => {
    ctx = createTestContext({ env: { API_KEYS: 'secret-1' } });
    const created = await request(ctx.app)
      .post('/shorten')
      .set('Authorization', 'Bearer secret-1')
      .send({ url: 'https://example.com/stats' })
      .expect(201);

    await request(ctx.app).get(`/stats/${created.body.code}`).expect(200);

    const guarded = createTestContext({
      env: { API_KEYS: 'secret-1', STATS_REQUIRE_AUTH: 'true' },
    });
    try {
      const other = await request(guarded.app)
        .post('/shorten')
        .set('Authorization', 'Bearer secret-1')
        .send({ url: 'https://example.com/stats2' })
        .expect(201);

      await request(guarded.app).get(`/stats/${other.body.code}`).expect(401);
      await request(guarded.app)
        .get(`/stats/${other.body.code}`)
        .set('Authorization', 'Bearer secret-1')
        .expect(200);
    } finally {
      guarded.cleanup();
    }
  });

  it('never leaks whether a key partially matched', async () => {
    ctx = createTestContext({ env: { API_KEYS: 'correct-horse' } });
    for (const attempt of ['correct', 'correct-horse-battery', '', 'CORRECT-HORSE']) {
      await request(ctx.app)
        .post('/shorten')
        .set('Authorization', `Bearer ${attempt}`)
        .send({ url: 'https://example.com/brute' })
        .expect(401);
    }
  });
});

describe('rate limiting', () => {
  it('returns 429 with a JSON body once the write budget is exhausted', async () => {
    ctx = createTestContext({
      env: { RATE_LIMIT_WRITE_PER_MINUTE: '3', RATE_LIMIT_GLOBAL_PER_MINUTE: '1000' },
      disableRateLimit: false,
    });

    for (let index = 0; index < 3; index += 1) {
      await request(ctx.app)
        .post('/shorten')
        .send({ url: `https://example.com/rl-${index}` })
        .expect(201);
    }

    const limited = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/rl-over' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('never throttles the health probe', async () => {
    ctx = createTestContext({
      env: { RATE_LIMIT_GLOBAL_PER_MINUTE: '2' },
      disableRateLimit: false,
    });

    for (let index = 0; index < 10; index += 1) {
      await request(ctx.app).get('/health').expect(200);
    }
  });

  it('advertises the limit in RateLimit headers', async () => {
    ctx = createTestContext({
      env: { RATE_LIMIT_WRITE_PER_MINUTE: '10' },
      disableRateLimit: false,
    });

    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: 'https://example.com/headers' })
      .expect(201);
    const header =
      response.headers['ratelimit-limit'] ??
      response.headers['ratelimit'] ??
      response.headers['rateLimit-Limit'];
    expect(String(header)).toContain('10');
  });
});

describe('input hardening', () => {
  it('rejects oversized bodies', async () => {
    ctx = createTestContext();
    const huge = { url: `https://example.com/${'a'.repeat(9000)}` };
    const response = await request(ctx.app).post('/shorten').send(huge);
    expect([400, 413]).toContain(response.status);
    expect(['PAYLOAD_TOO_LARGE', 'URL_TOO_LONG']).toContain(response.body.error.code);
  });

  it('rejects URL fields with a non-string type', async () => {
    ctx = createTestContext();
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: { $ne: null } })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not reflect script content in error messages', async () => {
    ctx = createTestContext();
    const response = await request(ctx.app)
      .post('/shorten')
      .send({ url: '<script>alert(1)</script>' })
      .expect(400);
    expect(response.text).not.toContain('<script>');
  });

  it('ignores prototype-polluting JSON keys', async () => {
    ctx = createTestContext();
    const response = await request(ctx.app)
      .post('/shorten')
      .set('Content-Type', 'application/json')
      .send('{"url":"https://example.com/pp","__proto__":{"polluted":true}}');
    // Either the strict schema rejects the unknown key or the parser drops it;
    // what matters is that Object.prototype is untouched.
    expect([201, 400]).toContain(response.status);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
