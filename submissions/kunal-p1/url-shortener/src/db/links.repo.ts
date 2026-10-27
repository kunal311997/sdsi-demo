/**
 * `links` table data access.
 *
 * Statements are prepared once per repository instance: `node:sqlite` compiles
 * them, so per-request parse cost is zero — that is what keeps the redirect path
 * in the low-hundreds-of-microseconds range.
 */

import type { DatabaseType, SqlObject } from './connection.js';
import type { LinkRow } from '../domain/types.js';

export interface InsertLinkParams {
  code: string;
  url: string;
  urlHash: string;
  alias: boolean;
  createdAt: number;
  expiresAt: number | null;
}

interface CountRow {
  total: number;
}

export class LinksRepository {
  readonly #insert;
  readonly #findByCode;
  readonly #findByCodeIncludingDeleted;
  readonly #findLiveByHash;
  readonly #findByAliasUrl;
  readonly #incrementClicks;
  readonly #softDelete;
  readonly #listAll;
  readonly #countAll;
  readonly #purgeExpired;
  readonly #exists;

  constructor(db: DatabaseType) {
    this.#insert = db.prepare(`
      INSERT INTO links (code, url, url_hash, alias, created_at, expires_at)
      VALUES (@code, @url, @urlHash, @alias, @createdAt, @expiresAt)
    `);
    this.#findByCode = db.prepare(
      'SELECT * FROM links WHERE code = ? COLLATE BINARY AND deleted_at IS NULL',
    );
    this.#findByCodeIncludingDeleted = db.prepare(
      'SELECT * FROM links WHERE code = ? COLLATE BINARY',
    );
    this.#findLiveByHash = db.prepare(`
      SELECT * FROM links
      WHERE url_hash = ? AND alias = 0 AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `);
    this.#findByAliasUrl = db.prepare(`
      SELECT * FROM links
      WHERE code = ? COLLATE BINARY AND url_hash = ? AND deleted_at IS NULL
      LIMIT 1
    `);
    this.#incrementClicks = db.prepare(`
      UPDATE links
         SET click_count = click_count + 1,
             last_accessed_at = @clickedAt
       WHERE code = @code
    `);
    this.#softDelete = db.prepare(
      'UPDATE links SET deleted_at = @deletedAt WHERE code = @code AND deleted_at IS NULL',
    );
    this.#listAll = db.prepare(`
      SELECT * FROM links
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT @limit OFFSET @offset
    `);
    this.#countAll = db.prepare('SELECT COUNT(*) AS total FROM links WHERE deleted_at IS NULL');
    this.#purgeExpired = db.prepare(
      'DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at < @before',
    );
    this.#exists = db.prepare('SELECT 1 AS hit FROM links WHERE code = ? COLLATE BINARY');
  }

  insert(params: InsertLinkParams): LinkRow {
    const bindings: SqlObject = {
      code: params.code,
      url: params.url,
      urlHash: params.urlHash,
      alias: params.alias ? 1 : 0,
      createdAt: params.createdAt,
      expiresAt: params.expiresAt,
    };
    this.#insert.run(bindings);
    const row = this.findByCodeIncludingDeleted(params.code);
    if (!row) throw new Error(`Inserted link ${params.code} could not be read back`);
    return row;
  }

  /** Case-sensitive lookup by code; soft-deleted links are excluded. */
  findByCode(code: string): LinkRow | undefined {
    return this.#findByCode.get(code) as LinkRow | undefined;
  }

  /** Includes soft-deleted rows; needed to distinguish 410 from 404. */
  findByCodeIncludingDeleted(code: string): LinkRow | undefined {
    return this.#findByCodeIncludingDeleted.get(code) as LinkRow | undefined;
  }

  /** Live (not deleted, not expired) non-alias link for a URL hash. */
  findLiveByHash(urlHash: string, now: number): LinkRow | undefined {
    return this.#findLiveByHash.get(urlHash, now) as LinkRow | undefined;
  }

  findByAliasAndUrl(code: string, urlHash: string): LinkRow | undefined {
    return this.#findByAliasUrl.get(code, urlHash) as LinkRow | undefined;
  }

  incrementClicks(code: string, clickedAt: number): void {
    this.#incrementClicks.run({ code, clickedAt });
  }

  softDelete(code: string, deletedAt: number): number {
    return Number(this.#softDelete.run({ code, deletedAt }).changes);
  }

  list(limit: number, offset: number): LinkRow[] {
    return this.#listAll.all({ limit, offset }) as unknown as LinkRow[];
  }

  count(): number {
    const row = this.#countAll.get() as CountRow | undefined;
    return row?.total ?? 0;
  }

  /** Physically delete links that expired before `before`; returns rows removed. */
  purgeExpiredBefore(before: number): number {
    return Number(this.#purgeExpired.run({ before }).changes);
  }

  /** True when the code exists in any state (used for alias collision checks). */
  codeExists(code: string): boolean {
    return this.#exists.get(code) !== undefined;
  }
}
