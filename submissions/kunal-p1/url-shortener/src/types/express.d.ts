/** Express/pino type augmentations so `req.log` and `res.locals` are typed. */

import type { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      log?: Logger;
    }

    interface Locals {
      requestId?: string;
      errorCode?: string;
    }
  }
}

export {};
