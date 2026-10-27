/**
 * SQLite connection factory built on Node's built-in `node:sqlite` module.
 *
 * Why not a native addon? `better-sqlite3` requires a compiled binary; when no
 * prebuilt artifact matches the platform/ABI, `npm install` needs Python and a
 * C++ toolchain and fails outright on many machines. `node:sqlite` ships with
 * Node itself, so `npm install` stays pure-JavaScript and the project runs
 * anywhere Node does. It is also synchronous, which is what keeps the redirect
 * path fast (no async scheduling, no connection pool).
 *
 * Pragmas:
 * - `journal_mode = WAL` lets readers and the writer coexist.
 * - `synchronous = NORMAL` is the standard WAL durability/throughput trade-off.
 * - `busy_timeout` makes concurrent writers wait instead of throwing SQLITE_BUSY.
 * - `foreign_keys = ON` enforces clicks -> links.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { runMigrations } from './migrations.js';

export type DatabaseType = DatabaseSync;

/** Value types accepted by `node:sqlite` statements. */
export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlObject = Record<string, SqlValue>;

export interface OpenDatabaseOptions {
  /** File path, or `:memory:` for an ephemeral database. */
  path: string;
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseType {
  const inMemory = options.path === ':memory:';
  const filename = inMemory ? ':memory:' : resolve(options.path);

  if (!inMemory) {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);

  // WAL is not meaningful for in-memory databases.
  if (!inMemory) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA temp_store = MEMORY');

  runMigrations(db);
  return db;
}

/**
 * Run `fn` inside a transaction.
 *
 * `immediate` (the default) issues `BEGIN IMMEDIATE`, taking SQLite's RESERVED
 * lock before the first statement. That serialises read-then-insert sequences
 * across connections, which is what makes shortening idempotent under
 * concurrency.
 *
 * `node:sqlite` has no `db.transaction()` helper, so BEGIN/COMMIT/ROLLBACK are
 * explicit here. Nested calls join the outer transaction.
 */
export function transaction<T>(
  db: DatabaseType,
  fn: () => T,
  mode: 'immediate' | 'deferred' = 'immediate',
): T {
  if (depth > 0) return fn();

  db.exec(mode === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN');
  depth += 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // A failed rollback means SQLite already aborted the transaction.
    }
    throw error;
  } finally {
    depth -= 1;
  }
}

// Node's SQLite bindings are synchronous and single-threaded per process, so a
// module-level depth counter is sufficient to detect nesting.
let depth = 0;

/** SQLite extended result codes we care about. */
export const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
export const SQLITE_CONSTRAINT_UNIQUE = 2067;

/** True when the error is a UNIQUE / PRIMARY KEY constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { errcode?: unknown; message?: unknown };
  if (
    candidate.errcode === SQLITE_CONSTRAINT_UNIQUE ||
    candidate.errcode === SQLITE_CONSTRAINT_PRIMARYKEY
  ) {
    return true;
  }
  // Fallback for drivers that only surface a message.
  return (
    typeof candidate.message === 'string' && /UNIQUE constraint failed/i.test(candidate.message)
  );
}
