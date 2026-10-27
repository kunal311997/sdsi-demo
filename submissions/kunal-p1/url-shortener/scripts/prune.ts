/**
 * Maintenance: physically delete links that expired more than N days ago,
 * including their click rows (ON DELETE CASCADE).
 *
 * Usage:
 *   npm run db:prune            # uses PRUNE_AFTER_DAYS from the environment
 *   npm run db:prune -- 90      # explicit retention window
 */

import 'dotenv/config';

import { parseConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { LinksRepository } from '../src/db/links.repo.js';

function main(): void {
  const config = parseConfig(process.env);
  const arg = process.argv[2];
  const retentionDays = arg === undefined ? config.PRUNE_AFTER_DAYS : Number.parseInt(arg, 10);

  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    console.error('Retention days must be a non-negative integer.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase({ path: config.DATABASE_PATH });
  try {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const removed = new LinksRepository(db).purgeExpiredBefore(cutoff);
    console.log(
      `Pruned ${removed} link(s) that expired before ${new Date(cutoff).toISOString()}` +
        ` (retention: ${retentionDays} day(s)).`,
    );
  } finally {
    db.close();
  }
}

main();
