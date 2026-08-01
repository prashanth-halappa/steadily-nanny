// Canonical API error codes shared between the API and its clients.

/**
 * Machine-readable error codes carried by every error envelope
 * (see `api-responses.ts`). Clients branch on these stable strings instead of
 * parsing human-readable messages.
 *
 * SETUP: add domain-specific codes as your API grows, but keep this generic
 * set intact so shared error handling keeps working.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
} as const;

/** A valid error code, derived from ERROR_CODES. */
export type ErrorCode = keyof typeof ERROR_CODES;
