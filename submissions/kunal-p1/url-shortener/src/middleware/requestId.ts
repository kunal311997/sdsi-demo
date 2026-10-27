/** Request correlation id: echoed on responses and attached to logs. */

import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const MAX_CLIENT_ID_LENGTH = 64;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * Accept a client-supplied id when it is short and boring, otherwise generate
 * one. Never echo arbitrary client input into headers unbounded.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  const id =
    typeof incoming === 'string' &&
    incoming.length > 0 &&
    incoming.length <= MAX_CLIENT_ID_LENGTH &&
    SAFE_ID.test(incoming)
      ? incoming
      : randomUUID();

  res.locals.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
