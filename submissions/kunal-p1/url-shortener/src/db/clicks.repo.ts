/** `clicks` table data access and aggregation. */

import type { DatabaseType } from './connection.js';
import type { ClickRow, NewClick } from '../domain/types.js';

export interface ClickTotals {
  total: number;
  uniqueVisitors: number;
  first: number | null;
  last: number | null;
}

export interface DayBucket {
  day: string;
  clicks: number;
}

export class ClicksRepository {
  readonly #insert;
  readonly #totals;
  readonly #perDay;
  readonly #recent;
  readonly #countAll;

  constructor(db: DatabaseType) {
    this.#insert = db.prepare(`
      INSERT INTO clicks (code, clicked_at, ip_hash, user_agent, referer)
      VALUES (@code, @clickedAt, @ipHash, @userAgent, @referer)
    `);
    this.#totals = db.prepare(`
      SELECT COUNT(*)                AS total,
             COUNT(DISTINCT ip_hash) AS uniqueVisitors,
             MIN(clicked_at)         AS first,
             MAX(clicked_at)         AS last
        FROM clicks
       WHERE code = ?
    `);
    // Bucketing happens in UTC inside SQLite, so it cannot drift with a
    // server's local timezone and it uses the (code, clicked_at) index.
    this.#perDay = db.prepare(`
      SELECT strftime('%Y-%m-%d', clicked_at / 1000, 'unixepoch') AS day,
             COUNT(*) AS clicks
        FROM clicks
       WHERE code = ?
       GROUP BY day
       ORDER BY day ASC
    `);
    this.#recent = db.prepare(
      'SELECT * FROM clicks WHERE code = ? ORDER BY clicked_at DESC, id DESC LIMIT ?',
    );
    this.#countAll = db.prepare('SELECT COUNT(*) AS total FROM clicks');
  }

  insert(click: NewClick): void {
    this.#insert.run({
      code: click.code,
      clickedAt: click.clickedAt,
      ipHash: click.ipHash,
      userAgent: click.userAgent,
      referer: click.referer,
    });
  }

  totals(code: string): ClickTotals {
    const row = this.#totals.get(code) as
      | { total: number; uniqueVisitors: number; first: number | null; last: number | null }
      | undefined;
    return {
      total: row?.total ?? 0,
      uniqueVisitors: row?.uniqueVisitors ?? 0,
      first: row?.first ?? null,
      last: row?.last ?? null,
    };
  }

  perDay(code: string): DayBucket[] {
    return this.#perDay.all(code) as unknown as DayBucket[];
  }

  recent(code: string, limit = 20): ClickRow[] {
    return this.#recent.all(code, limit) as unknown as ClickRow[];
  }

  countAll(): number {
    const row = this.#countAll.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }
}
