/**
 * Express application factory.
 *
 * Kept separate from `index.ts` so tests can build an app against an in-memory
 * database and an injected clock without opening a socket.
 *
 * Route order matters:
 *   1. observability + security headers
 *   2. health, shorten, stats, links (specific paths)
 *   3. static dashboard
 *   4. `/:code` redirect (catch-all single segment, mounted last)
 *   5. 404 + error handler
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import type { AppConfig } from './config.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { createHealthRouter } from './routes/health.js';
import { createLinksRouter } from './routes/links.js';
import { createRedirectRouter } from './routes/redirect.js';
import { createShortenRouter } from './routes/shorten.js';
import { createStatsRouter } from './routes/stats.js';
import type { AuthMiddleware } from './routes/types.js';
import { LinkService } from './services/linkService.js';
import type { Clock } from './lib/clock.js';
import type { Logger } from './lib/logger.js';
import type { DatabaseType } from './db/connection.js';

export interface BuildAppOptions {
  config: AppConfig;
  db: DatabaseType;
  clock: Clock;
  logger: Logger;
  /** Absolute path to the `public/` directory; omitted in unit tests. */
  publicDir?: string | null;
  /** Turn rate limiting off for integration tests that are not testing limits. */
  disableRateLimit?: boolean;
}

export interface BuiltApp {
  app: Express;
  service: LinkService;
}

const SECURITY_HEADERS = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // No inline scripts or styles: the dashboard ships external files only.
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' as const },
  hsts: false,
};

export function buildApp(options: BuildAppOptions): BuiltApp {
  const { config, db, clock, logger } = options;

  const service = new LinkService({
    db,
    clock,
    logger,
    publicBaseUrl: config.publicBaseUrl,
    codeLength: config.CODE_LENGTH,
    maxUrlLength: config.MAX_URL_LENGTH,
    allowPrivateHosts: config.ALLOW_PRIVATE_HOSTS,
    selfOrigins: config.selfOrigins,
    expiryMaxDays: config.EXPIRY_MAX_DAYS,
    ipSalt: config.IP_SALT,
  });

  const app = express();

  app.disable('x-powered-by');
  app.set('env', config.NODE_ENV);
  app.set('trust proxy', config.trustProxy);
  // Case-sensitive routing means alias `Stats` can never shadow `/stats`.
  app.set('case sensitive routing', true);
  app.set('strict routing', false);
  app.set('etag', false);

  app.use(requestId);
  app.use(helmet(SECURITY_HEADERS));

  app.use(
    pinoHttp({
      logger,
      // Log the path only: query strings may contain a full target URL.
      customProps: (_req, res) => ({
        requestId: res.locals.requestId as string | undefined,
      }),
      serializers: {
        req: (req: { method?: string; url?: string }) => ({
          method: req.method,
          path: req.url?.split('?')[0],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: {
        ignore: (req) => req.url === '/health',
      },
    }),
  );

  app.use(express.json({ limit: '8kb', strict: true, type: 'application/json' }));
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));

  const limiters = createRateLimiters({
    globalPerMinute: config.RATE_LIMIT_GLOBAL_PER_MINUTE,
    writePerMinute: config.RATE_LIMIT_WRITE_PER_MINUTE,
    redirectPerMinute: config.RATE_LIMIT_REDIRECT_PER_MINUTE,
    disabled: options.disableRateLimit ?? false,
  });

  const requireApiKey = createAuthMiddleware(config.apiKeys);
  // Stats are public by default so links can be shared; flip STATS_REQUIRE_AUTH
  // to protect per-link analytics.
  const statsAuth: AuthMiddleware = config.STATS_REQUIRE_AUTH
    ? requireApiKey
    : (_req, _res, next) => next();

  app.use(limiters.global);

  app.use(createHealthRouter(service, clock.now()));
  app.use(createShortenRouter(service, requireApiKey, limiters));
  app.use(createStatsRouter(service, statsAuth));
  app.use(createLinksRouter(service, requireApiKey, limiters));

  if (options.publicDir && existsSync(options.publicDir)) {
    app.use(
      express.static(options.publicDir, {
        index: 'index.html',
        etag: false,
        maxAge: 0,
        dotfiles: 'ignore',
        // Keep static serving to `/` and known assets; codes live at the root too.
        fallthrough: true,
      }),
    );
  }

  app.use(createRedirectRouter(service, limiters));

  app.use(notFoundHandler);
  app.use(
    createErrorHandler({
      exposeInternals: config.NODE_ENV !== 'production',
    }),
  );

  return { app, service };
}

/** Convenience helper used by tests and `index.ts`. */
export function defaultPublicDir(): string {
  return join(process.cwd(), 'public');
}
