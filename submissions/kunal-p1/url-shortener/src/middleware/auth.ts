/**
 * API-key authentication.
 *
 * Keys are supplied as `Authorization: Bearer <key>` or `X-API-Key: <key>` and
 * compared in constant time against the configured set. When no keys are
 * configured (development default) the middleware is a pass-through, and the
 * config layer forbids that state in production.
 */

import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';
import { matchesAnyKey } from '../lib/crypto.js';

export function extractApiKey(req: Request): string | null {
  const header = req.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
    return null;
  }
  const apiKeyHeader = req.get('x-api-key');
  if (apiKeyHeader) return apiKeyHeader.trim();
  return null;
}

export function createAuthMiddleware(apiKeys: readonly string[]) {
  const enabled = apiKeys.length > 0;

  return function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
    if (!enabled) {
      next();
      return;
    }

    const presented = extractApiKey(req);
    if (!presented) {
      next(
        new AppError('UNAUTHORIZED', 'Missing API key. Send `Authorization: Bearer <key>`', {
          hint: 'authorization',
        }),
      );
      return;
    }

    if (!matchesAnyKey(presented, apiKeys)) {
      next(new AppError('UNAUTHORIZED', 'Invalid API key'));
      return;
    }

    next();
  };
}
