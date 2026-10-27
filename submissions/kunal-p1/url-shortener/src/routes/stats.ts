/** `GET /stats/:code` and `GET /stats/:code/clicks` (M5). */

import { Router } from 'express';

import { clampInteger } from '../services/linkService.js';
import type { LinkService } from '../services/linkService.js';
import { firstParam } from './types.js';
import type { AuthMiddleware } from './types.js';

export function createStatsRouter(service: LinkService, requireApiKey: AuthMiddleware): Router {
  const router = Router();

  router.get('/stats/:code', requireApiKey, (req, res) => {
    const code = firstParam(req.params.code);
    const stats = service.getStats(code);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      code: stats.code,
      shortUrl: service.shortUrlFor(stats.code),
      targetUrl: stats.url,
      createdAt: stats.createdAt,
      expiresAt: stats.expiresAt,
      deletedAt: stats.deletedAt,
      expired: stats.expired,
      totalClicks: stats.totalClicks,
      uniqueVisitors: stats.uniqueVisitors,
      firstAccessedAt: stats.firstAccessedAt,
      lastAccessedAt: stats.lastAccessedAt,
      clickDays: stats.clickDays,
      clicksPerDay: stats.clicksPerDay,
    });
  });

  router.get('/stats/:code/clicks', requireApiKey, (req, res) => {
    const code = firstParam(req.params.code);
    const requested = Number.parseInt(String(req.query.limit ?? '20'), 10);
    const limit = clampInteger(Number.isFinite(requested) ? requested : 20, 1, 100);

    const clicks = service.recentClicks(code, limit).map((click) => ({
      clickedAt: click.clickedAt,
      userAgent: click.userAgent,
      referer: click.referer,
    }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({ code, limit, clicks });
  });

  return router;
}
