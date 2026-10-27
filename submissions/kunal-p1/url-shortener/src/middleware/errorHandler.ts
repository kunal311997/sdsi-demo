/**
 * Central error handling.
 *
 * Converts `AppError` into the documented error envelope and turns anything
 * unexpected into an opaque 500 (details stay in the logs, keyed by request id).
 * Body-parser and framework errors are mapped to stable codes so clients never
 * receive HTML error pages.
 */

import type { NextFunction, Request, Response } from 'express';

import { AppError, ERROR_CODES, isAppError } from '../domain/errors.js';
import type { ErrorCode } from '../domain/errors.js';

interface HttpishError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

function mapFrameworkError(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as HttpishError;
  const status = candidate.status ?? candidate.statusCode;
  switch (status) {
    case 400:
      return new AppError('VALIDATION_ERROR', 'Request could not be parsed', {
        reason: candidate.type ?? 'bad_request',
      });
    case 413:
      return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');
    case 415:
      return new AppError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    default:
      return null;
  }
}

export interface ErrorHandlerOptions {
  /** Hide internal messages for unexpected failures. */
  exposeInternals: boolean;
}

export function createErrorHandler(options: ErrorHandlerOptions) {
  return function errorHandler(
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = (res.locals.requestId as string | undefined) ?? undefined;
    const mapped = isAppError(error) ? error : mapFrameworkError(error);
    const appError =
      mapped ??
      new AppError(
        'INTERNAL_ERROR',
        options.exposeInternals && error instanceof Error ? error.message : 'Internal server error',
      );

    const log = req.log;
    const logPayload = {
      err: error,
      requestId,
      status: appError.status,
      code: appError.code,
      method: req.method,
      // Never log the query string: it can carry a full target URL.
      path: req.path,
    };

    if (appError.status >= 500) {
      if (log) log.error(logPayload, 'request failed');
      else console.error('request failed', logPayload);
    } else if (appError.status !== 404) {
      if (log) log.warn(logPayload, 'request rejected');
      else console.warn('request rejected', logPayload);
    }

    // The rate limiter writes its own body; do not double-send.
    if (res.locals.errorCode === 'RATE_LIMITED') return;

    res.status(appError.status).json({
      error: {
        code: appError.code as ErrorCode,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    });
  };
}

/** 404 handler for unmatched routes; mounted after all real routes. */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  const requestId = (res.locals.requestId as string | undefined) ?? undefined;
  res.status(ERROR_CODES.ROUTE_NOT_FOUND).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      ...(requestId ? { requestId } : {}),
    },
  });
}

/** 405 helper: distinguishes "wrong verb for an existing path" from a plain 404. */
export function methodNotAllowed(allowed: readonly string[]) {
  return function handler(_req: Request, res: Response): void {
    const requestId = (res.locals.requestId as string | undefined) ?? undefined;
    res.setHeader('Allow', allowed.join(', '));
    res.status(ERROR_CODES.METHOD_NOT_ALLOWED).json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed for this resource',
        details: { allowed },
        ...(requestId ? { requestId } : {}),
      },
    });
  };
}
