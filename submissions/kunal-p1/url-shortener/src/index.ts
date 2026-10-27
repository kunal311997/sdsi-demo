/**
 * Process entrypoint: load config, open the database, listen, shut down cleanly.
 *
 * Graceful shutdown matters for SQLite: on SIGTERM we stop accepting new
 * connections, let in-flight requests finish, then close the database so WAL
 * can checkpoint instead of leaving `-wal`/`-shm` files behind.
 */

import 'dotenv/config';

import { buildApp, defaultPublicDir } from './app.js';
import { ConfigError, describeConfig, parseConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { createLogger } from './lib/logger.js';
import { systemClock } from './lib/clock.js';

function main(): void {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[startup] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const logger = createLogger(config);
  const db = openDatabase({ path: config.DATABASE_PATH });
  const { app } = buildApp({
    config,
    db,
    clock: systemClock,
    logger,
    publicDir: defaultPublicDir(),
  });

  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(
      { ...describeConfig(config), url: `http://${config.HOST}:${config.PORT}` },
      'url-shortener listening',
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal({ port: config.PORT }, 'port already in use');
    } else {
      logger.fatal({ err: error }, 'server error');
    }
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close((error) => {
      if (error) logger.error({ err: error }, 'error while closing server');
      try {
        db.close();
        logger.info('database closed');
      } catch (closeError) {
        logger.error({ err: closeError }, 'error while closing database');
      }
      clearTimeout(forceExit);
      process.exit(error ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception, exiting');
    shutdown('uncaughtException');
  });
}

main();
