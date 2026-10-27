/**
 * Rate limiting.
 *
 * Three independent buckets protect different failure modes:
 * - global:   blunt flood protection for every route.
 * - write:    creation abuse (the expensive path, and the phishing vector).
 * - redirect: hot-link hammering of a single code.
 *
 * The default store is in-memory, which is correct for a single instance. Any
 * multi-instance deployment must swap in a shared store (see docs/ARCHITECTURE.md).
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';

import { AppError, ERROR_CODES } from '../domain/errors.js';

const WINDOW_MS = 60_000;

function handler(req: Request, res: Response): void {
  const error = new AppError('RATE_LIMITED', 'Too many requests, slow down and retry shortly', {
    limit: res.getHeader('RateLimit-Limit') ?? undefined,
    retryAfterSeconds: Math.ceil(WINDOW_MS / 1000),
  });
  const body = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: res.locals.requestId as string | undefined,
    },
  };
  res.locals.errorCode = 'RATE_LIMITED';
  req.log?.warn({ path: req.path, status: ERROR_CODES.RATE_LIMITED }, 'rate limit exceeded');
  res.status(ERROR_CODES.RATE_LIMITED).json(body);
}

export interface RateLimiters {
  global: RateLimitRequestHandler;
  write: RateLimitRequestHandler;
  redirect: RateLimitRequestHandler;
}

export interface RateLimitOptions {
  globalPerMinute: number;
  writePerMinute: number;
  redirectPerMinute: number;
  /** Disable limits entirely (tests only). */
  disabled?: boolean;
}

export function createRateLimiters(options: RateLimitOptions): RateLimiters {
  const common = {
    windowMs: WINDOW_MS,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    handler,
    // /health is used by orchestrators and must never be throttled.
    skip: (req: Request) => req.path === '/health',
  };

  const noop = ((_req: Request, _res: Response, next: NextFunction) =>
    next()) as unknown as RateLimitRequestHandler;

  if (options.disabled) {
    return { global: noop, write: noop, redirect: noop };
  }

  return {
    global: rateLimit({ ...common, limit: options.globalPerMinute }),
    write: rateLimit({ ...common, limit: options.writePerMinute }),
    redirect: rateLimit({ ...common, limit: options.redirectPerMinute }),
  };
}
