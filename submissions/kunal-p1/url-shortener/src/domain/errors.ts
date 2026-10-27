/**
 * Error model shared by the domain, service and HTTP layers.
 *
 * Every failure the API can produce has a stable machine-readable `code`.
 * The HTTP layer maps `status` directly, so business rules never import
 * Express and stay unit-testable.
 */

export const ERROR_CODES = {
  // 400 - request is understood but invalid
  VALIDATION_ERROR: 400,
  INVALID_URL: 400,
  URL_TOO_LONG: 400,
  UNSUPPORTED_SCHEME: 400,
  URL_HAS_CREDENTIALS: 400,
  BLOCKED_HOST: 400,
  SELF_REFERENCE: 400,
  INVALID_ALIAS: 400,
  ALIAS_RESERVED: 400,
  INVALID_EXPIRY: 400,
  EXPIRY_IN_PAST: 400,
  EXPIRY_TOO_FAR: 400,
  // 401/403
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  // 404/405/409/410/413/415/429
  ROUTE_NOT_FOUND: 404,
  LINK_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  ALIAS_TAKEN: 409,
  CONFLICT: 409,
  LINK_GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  // 5xx
  INTERNAL_ERROR: 500,
  CODE_GENERATION_FAILED: 503,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Optional machine-readable context, e.g. `{ field: 'url' }`. */
    details?: Record<string, unknown>;
    /** Correlation id; also returned in the `x-request-id` response header. */
    requestId?: string;
  };
}

/**
 * An expected, intentional failure. Anything that is *not* an AppError is
 * treated as a bug: logged with a stack trace and reported as 500 without
 * leaking internals to the client.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly expose = true;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    if (details) this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
