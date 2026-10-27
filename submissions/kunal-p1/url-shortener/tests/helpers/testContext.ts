/**
 * Shared test fixtures.
 *
 * Each call builds an isolated in-memory database plus an injectable clock, so
 * tests are order-independent and never touch the filesystem.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Express } from 'express';

import { buildApp } from '../../src/app.js';
import { parseConfig, type AppConfig } from '../../src/config.js';
import { openDatabase, type DatabaseType } from '../../src/db/connection.js';
import { fixedClock } from '../../src/lib/clock.js';
import { silentLogger } from '../../src/lib/logger.js';
import { LinkService } from '../../src/services/linkService.js';

export const T0 = Date.parse('2026-01-15T10:00:00.000Z');

export interface TestContext {
  db: DatabaseType;
  clock: ReturnType<typeof fixedClock>;
  service: LinkService;
  app: Express;
  config: AppConfig;
  cleanup: () => void;
}

export interface TestContextOptions {
  dbPath?: string;
  env?: NodeJS.ProcessEnv;
  disableRateLimit?: boolean;
}

export function testEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    BASE_URL: 'http://short.test',
    DATABASE_PATH: ':memory:',
    CODE_LENGTH: '7',
    ALLOW_PRIVATE_HOSTS: 'false',
    API_KEYS: '',
    IP_SALT: 'test-salt-value',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_GLOBAL_PER_MINUTE: '10000',
    RATE_LIMIT_WRITE_PER_MINUTE: '10000',
    RATE_LIMIT_REDIRECT_PER_MINUTE: '10000',
    ...overrides,
  };
}

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const config = parseConfig(testEnv(options.env));
  const db = openDatabase({ path: options.dbPath ?? ':memory:' });
  const clock = fixedClock(T0);
  const service = new LinkService({
    db,
    clock,
    logger: silentLogger,
    publicBaseUrl: config.publicBaseUrl,
    codeLength: config.CODE_LENGTH,
    maxUrlLength: config.MAX_URL_LENGTH,
    allowPrivateHosts: config.ALLOW_PRIVATE_HOSTS,
    selfOrigins: config.selfOrigins,
    expiryMaxDays: config.EXPIRY_MAX_DAYS,
    ipSalt: config.IP_SALT,
  });

  const { app } = buildApp({
    config,
    db,
    clock,
    logger: silentLogger,
    publicDir: null,
    disableRateLimit: options.disableRateLimit ?? true,
  });

  return {
    db,
    clock,
    service,
    app,
    config,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // Already closed by the test.
      }
    },
  };
}

/** Service-only context (no Express app) for unit-level tests. */
export function createServiceContext(options: TestContextOptions = {}): TestContext {
  return createTestContext(options);
}

/** A temp directory that is removed by the returned disposer. */
export function tempDir(): { path: string; dispose: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'url-shortener-test-'));
  return {
    path,
    dispose: () => rmSync(path, { recursive: true, force: true }),
  };
}
