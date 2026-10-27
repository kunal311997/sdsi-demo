/** Shared route helpers and types. */

import type { NextFunction, Request, Response } from 'express';

export type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void;

/**
 * Express 5 types route params as `string | string[]` because a param can be
 * repeated. Route definitions here never repeat params, so take the first value.
 */
export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
