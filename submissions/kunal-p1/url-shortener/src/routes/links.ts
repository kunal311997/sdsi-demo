/** `GET /links` list and `DELETE /:code` management endpoints. */

import { Router } from 'express';

import { clampInteger } from '../services/linkService.js';
import type { RateLimiters } from '../middleware/rateLimit.js';
import type { LinkService } from '../services/linkService.js';
import { firstParam } from './types.js';
import type { AuthMiddleware } from './types.js';

export function createLinksRouter(
  service: LinkService,
  requireApiKey: AuthMiddleware,
  limiters: RateLimiters,
): Router {
  const router = Router();

  router.get('/links', requireApiKey, (req, res) => {
    const rawLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
    const rawOffset = Number.parseInt(String(req.query.offset ?? '0'), 10);

    const result = service.listLinks(
      Number.isFinite(rawLimit) ? rawLimit : 50,
      Number.isFinite(rawOffset) ? rawOffset : 0,
    );

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      items: result.items,
      total: result.total,
      limit: clampInteger(result.limit, 1, 100),
      offset: result.offset,
    });
  });

  router.delete('/:code', limiters.write, requireApiKey, (req, res) => {
    const code = firstParam(req.params.code);
    service.deleteLink(code);
    res.status(200).json({ code, deleted: true });
  });

  return router;
}
