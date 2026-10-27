/**
 * Forward-only migration runner.
 *
 * Each migration runs inside a transaction and is recorded in
 * `schema_migrations`, so booting twice is a no-op and an interrupted upgrade
 * can never leave the schema half-applied.
 */

import type { DatabaseType } from './connection.js';

interface Migration {
  id: number;
  name: string;
  up: (db: DatabaseType) => void;
}

const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'links-and-clicks',
    up: (db) => {
      db.exec(`
        CREATE TABLE links (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          code             TEXT    NOT NULL,
          url              TEXT    NOT NULL,
          url_hash         TEXT    NOT NULL,
          alias            INTEGER NOT NULL DEFAULT 0 CHECK (alias IN (0, 1)),
          created_at       INTEGER NOT NULL,
          expires_at       INTEGER,
          deleted_at       INTEGER,
          click_count      INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
          last_accessed_at INTEGER
        );

        -- Codes are globally unique; the UNIQUE index also provides the atomic
        -- insert-or-fail guarantee used for alias collisions.
        CREATE UNIQUE INDEX idx_links_code ON links (code);

        -- Idempotent shortening lookup (M4): live, non-expiring links only.
        -- The partial unique index both speeds up the lookup and guarantees that
        -- two concurrent requests cannot both create a duplicate.
        CREATE UNIQUE INDEX idx_links_dedupe
          ON links (url_hash)
          WHERE alias = 0 AND expires_at IS NULL AND deleted_at IS NULL;

        -- General dedupe/activity lookups (includes expiring links).
        CREATE INDEX idx_links_url_hash ON links (url_hash);
        CREATE INDEX idx_links_created_at ON links (created_at DESC);

        CREATE TABLE clicks (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          code       TEXT    NOT NULL REFERENCES links (code) ON DELETE CASCADE,
          clicked_at INTEGER NOT NULL,
          ip_hash    TEXT,
          user_agent TEXT,
          referer    TEXT
        );

        -- Covers both the per-day aggregation and the recent-activity query.
        CREATE INDEX idx_clicks_code_time ON clicks (code, clicked_at DESC);
        CREATE INDEX idx_clicks_time ON clicks (clicked_at);
      `);
    },
  },
  {
    id: 2,
    name: 'expiry-index',
    up: (db) => {
      // Supports the prune job and expired-link reporting.
      db.exec(
        'CREATE INDEX idx_links_expires_at ON links (expires_at) WHERE expires_at IS NOT NULL;',
      );
    },
  },
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]?.id ?? 0;

export function runMigrations(db: DatabaseType): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>;
  const applied = new Set(appliedRows.map((row) => row.id));
  const record = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      record.run(migration.id, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite already aborted the transaction.
      }
      throw error;
    }
  }

  return LATEST_SCHEMA_VERSION;
}

export function schemaVersion(db: DatabaseType): number {
  const row = db.prepare('SELECT MAX(id) AS version FROM schema_migrations').get() as
    { version: number | null } | undefined;
  return row?.version ?? 0;
}
