/** Strict request-body validation with Zod, surfaced as AppError. */

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../domain/errors.js';

export const shortenBodySchema = z
  .object({
    url: z.string({ error: '`url` is required and must be a string' }),
    alias: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .strict();

export type ShortenBody = z.infer<typeof shortenBodySchema>;

/** Reject non-JSON content types early with a precise status code. */
export function requireJson(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    next();
    return;
  }
  if (!req.is('application/json')) {
    next(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
    return;
  }
  next();
}

export function validateBody<T>(schema: z.ZodType<T>) {
  return function validator(req: Request, _res: Response, next: NextFunction): void {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      next(
        new AppError('VALIDATION_ERROR', details[0]?.message ?? 'Invalid request body', {
          issues: details,
        }),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}
