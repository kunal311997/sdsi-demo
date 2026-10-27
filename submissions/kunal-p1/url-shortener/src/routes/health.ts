/** `GET /health` - liveness/readiness probe, never rate limited or cached. */

import { Router } from 'express';

import type { LinkService } from '../services/linkService.js';

export function createHealthRouter(service: LinkService, startedAt: number): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const db = service.checkDatabase();
    res.setHeader('Cache-Control', 'no-store');
    res.status(db.ok ? 200 : 503).json({
      status: db.ok ? 'ok' : 'degraded',
      database: db.ok ? 'ok' : 'error',
      schemaVersion: db.schemaVersion,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
