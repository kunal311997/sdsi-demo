/**
 * `GET|HEAD /:code` - the redirect endpoint (M2).
 *
 * 302 Found  - always a temporary redirect, never 301, so expiry and deletion
 *              take effect immediately instead of being cached by browsers.
 * 410 Gone   - expired or deleted links.
 * 404        - unknown code.
 *
 * Headers on the redirect:
 * - `Cache-Control: no-store` stops intermediary/browser caching of the hop.
 * - `Referrer-Policy: no-referrer` stops leaking the shortener URL.
 * - `X-Robots-Tag: noindex` keeps short links out of search indexes.
 *
 * One handler serves GET and HEAD: Express dispatches HEAD to `router.get()`
 * handlers, so a separate `router.head()` would never run and HEAD requests
 * would be counted as clicks. The method is checked explicitly instead.
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../domain/errors.js';
import type { LinkService } from '../services/linkService.js';
import type { RateLimiters } from '../middleware/rateLimit.js';
import { firstParam } from './types.js';

export function createRedirectRouter(service: LinkService, limiters: RateLimiters): Router {
  const router = Router();

  function resolveHandler(req: Request, res: Response, next: NextFunction): void {
    const code = firstParam(req.params.code);
    if (!code) {
      next(new AppError('LINK_NOT_FOUND', 'Short code not found'));
      return;
    }

    try {
      // `resolve` throws AppError(404|410) which the error handler maps.
      const link = service.resolve(code);

      // A HEAD request is a probe or link preview: it must not inflate analytics.
      if (req.method !== 'HEAD') {
        service.recordClick(code, {
          ip: req.ip,
          userAgent: req.get('user-agent'),
          referer: req.get('referer'),
        });
      }

      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');

      if (req.method === 'HEAD') {
        res.status(302).setHeader('Location', link.url);
        res.end();
        return;
      }

      res.redirect(302, link.url);
    } catch (error) {
      next(error);
    }
  }

  router.get('/:code', limiters.redirect, resolveHandler);
  router.head('/:code', limiters.redirect, resolveHandler);

  // Explicitly document that other verbs are not valid on a code. `DELETE` is
  // handled by the links router, which is mounted before this one.
  router.all('/:code', (_req, res) => {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed for a short code',
        details: { allowed: ['GET', 'HEAD'] },
        requestId: res.locals.requestId,
      },
    });
  });

  return router;
}
