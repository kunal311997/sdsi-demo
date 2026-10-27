import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../src/domain/errors.js';
import { createServiceContext, T0, tempDir, type TestContext } from '../helpers/testContext.js';
import { openDatabase } from '../../src/db/connection.js';
let ctx: TestContext;

beforeEach(() => {
  ctx = createServiceContext();
});

afterEach(() => {
  ctx.cleanup();
});

describe('LinkService', () => {
  it('creates a link and resolves it', () => {
    const created = ctx.service.createLink({ url: 'https://example.com/service' });
    expect(created.created).toBe(true);

    const resolved = ctx.service.resolve(created.link.code);
    expect(resolved.url).toBe('https://example.com/service');
  });

  it('is idempotent for the same normalised URL', () => {
    const first = ctx.service.createLink({ url: 'https://example.com/x' });
    const second = ctx.service.createLink({ url: 'HTTPS://EXAMPLE.COM:443/x' });
    expect(second.link.code).toBe(first.link.code);
    expect(second.created).toBe(false);
  });

  it('mints a new code after expiry and leaves the old one gone', () => {
    const first = ctx.service.createLink({
      url: 'https://example.com/renew',
      expiresAt: '2026-01-20T00:00:00Z',
    });

    ctx.clock.set(Date.parse('2026-01-25T00:00:00Z'));

    const second = ctx.service.createLink({ url: 'https://example.com/renew' });
    expect(second.link.code).not.toBe(first.link.code);
    expect(() => ctx.service.resolve(first.link.code)).toThrow(AppError);
  });

  it('rejects reusing an alias owned by an expired link', () => {
    ctx.service.createLink({
      url: 'https://example.com/same-target',
      alias: 'reused',
      expiresAt: '2026-01-20T00:00:00Z',
    });

    ctx.clock.set(Date.parse('2026-01-21T00:00:00Z'));

    expect(() =>
      ctx.service.createLink({ url: 'https://example.com/same-target', alias: 'reused' }),
    ).toThrow(/expired link/);
  });

  it('records clicks and exposes totals', () => {
    const created = ctx.service.createLink({ url: 'https://example.com/clicks' });
    ctx.service.recordClick(created.link.code, { ip: '203.0.113.5', userAgent: 'vitest' });
    ctx.service.recordClick(created.link.code, { ip: '203.0.113.5', userAgent: 'vitest' });

    const stats = ctx.service.getStats(created.link.code);
    expect(stats.totalClicks).toBe(2);
    expect(stats.uniqueVisitors).toBe(1);
    expect(stats.lastAccessedAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('does not throw when the click write fails', () => {
    const created = ctx.service.createLink({ url: 'https://example.com/fail-open' });
    // Drop the table so the insert fails, then restore it.
    ctx.db.exec('ALTER TABLE clicks RENAME TO clicks_backup');
    try {
      expect(() => ctx.service.recordClick(created.link.code, { ip: '203.0.113.5' })).not.toThrow();
    } finally {
      ctx.db.exec('ALTER TABLE clicks_backup RENAME TO clicks');
    }
  });

  it('soft-deletes and keeps stats', () => {
    const created = ctx.service.createLink({ url: 'https://example.com/del' });
    ctx.service.recordClick(created.link.code);

    ctx.service.deleteLink(created.link.code);
    expect(() => ctx.service.resolve(created.link.code)).toThrow(/deleted/);
    expect(ctx.service.getStats(created.link.code).deletedAt).not.toBeNull();
  });

  it('throws LINK_NOT_FOUND for unknown codes on every read path', () => {
    const missing = 'zzzzzzz';
    expect(() => ctx.service.resolve(missing)).toThrow(AppError);
    expect(() => ctx.service.getStats(missing)).toThrow(AppError);
    expect(() => ctx.service.recentClicks(missing)).toThrow(AppError);
    expect(() => ctx.service.deleteLink(missing)).toThrow(AppError);
  });

  it('purges long-expired links only', () => {
    const expired = ctx.service.createLink({
      url: 'https://example.com/old',
      expiresAt: '2026-01-16T00:00:00Z',
    });
    const alive = ctx.service.createLink({ url: 'https://example.com/alive' });

    ctx.clock.set(T0 + 90 * 86_400_000);
    const removed = ctx.service.purgeExpired(30);

    expect(removed).toBe(1);
    expect(() => ctx.service.resolve(expired.link.code)).toThrow(AppError);
    expect(ctx.service.resolve(alive.link.code).code).toBe(alive.link.code);
  });

  it('reports database health', () => {
    expect(ctx.service.checkDatabase()).toEqual({ ok: true, schemaVersion: 2 });
  });
});

describe('persistence', () => {
  it('reopens an existing database without re-running migrations', () => {
    const directory = tempDir();
    const path = `${directory.path}/links.db`;

    try {
      const first = openDatabase({ path });
      const insert = first.prepare(`
        INSERT INTO links (code, url, url_hash, alias, created_at)
        VALUES ('keep123', 'https://example.com/keep', 'hashkeep', 0, 1)
      `);
      insert.run();
      first.close();

      const second = openDatabase({ path });
      const row = second.prepare('SELECT code FROM links').get() as { code: string };
      expect(row.code).toBe('keep123');
      const version = second.prepare('SELECT MAX(id) AS v FROM schema_migrations').get() as {
        v: number;
      };
      expect(version.v).toBe(2);
      second.close();
    } finally {
      directory.dispose();
    }
  });

  it('enforces unique codes at the database level', () => {
    const now = T0;
    ctx.db
      .prepare(`INSERT INTO links (code, url, url_hash, alias, created_at) VALUES (?, ?, ?, 0, ?)`)
      .run('dupe123', 'https://example.com/a', 'hash-a', now);

    expect(() =>
      ctx.db
        .prepare(
          `INSERT INTO links (code, url, url_hash, alias, created_at) VALUES (?, ?, ?, 0, ?)`,
        )
        .run('dupe123', 'https://example.com/b', 'hash-b', now),
    ).toThrow(/UNIQUE/);
  });

  it('cascades click deletion when a link is purged', () => {
    const created = ctx.service.createLink({ url: 'https://example.com/cascade' });
    ctx.service.recordClick(created.link.code);
    ctx.db.prepare('DELETE FROM links WHERE code = ?').run(created.link.code);

    const remaining = ctx.db.prepare('SELECT COUNT(*) AS total FROM clicks').get() as {
      total: number;
    };
    expect(remaining.total).toBe(0);
  });

  it('keeps throwing a typed error, not a raw SQLite error, on unknown codes', () => {
    try {
      ctx.service.resolve('nope123');
      throw new Error('should not reach');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(404);
    }
  });
});
