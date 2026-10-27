/**
 * `POST /shorten` (M1, M3, M4).
 *
 * 201 Created  - a new code was minted.
 * 200 OK       - an existing code was returned for an already-shortened URL.
 * 400          - invalid URL/alias/expiry.
 * 409          - custom alias already taken by a different URL.
 */

import { Router } from 'express';

import { toIso } from '../domain/expiry.js';
import { requireJson, shortenBodySchema, validateBody } from '../middleware/validation.js';
import type { RateLimiters } from '../middleware/rateLimit.js';
import type { LinkService } from '../services/linkService.js';
import type { AuthMiddleware } from './types.js';

export function createShortenRouter(
  service: LinkService,
  requireApiKey: AuthMiddleware,
  limiters: RateLimiters,
): Router {
  const router = Router();

  router.post(
    '/shorten',
    limiters.write,
    requireJson,
    requireApiKey,
    validateBody(shortenBodySchema),
    (req, res) => {
      const { url, alias, expiresAt } = req.body as {
        url: string;
        alias?: string;
        expiresAt?: string;
      };

      const result = service.createLink({ url, alias, expiresAt });

      res.status(result.created ? 201 : 200).json({
        code: result.link.code,
        shortUrl: result.shortUrl,
        targetUrl: result.link.url,
        createdAt: toIso(result.link.created_at),
        expiresAt: toIso(result.link.expires_at),
        isCustomAlias: result.link.alias === 1,
        created: result.created,
      });
    },
  );

  // Explicit 405 so clients get JSON instead of the catch-all 404.
  router.all('/shorten', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Use POST to shorten a URL',
        details: { allowed: ['POST'] },
        requestId: res.locals.requestId,
      },
    });
  });

  return router;
}
