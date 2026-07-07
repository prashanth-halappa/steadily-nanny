import { ZodError } from 'zod';
import { BaseError } from './BaseError';

/**
 * True when an error is an EXPECTED operational client error (4xx) — a raw
 * ZodError (pre-conversion 400) or any operational BaseError with a 4xx status.
 * These represent handled request flow, not crashes, and must NOT be reported to
 * Sentry as exceptions. Used by both the error handler and the Sentry winston
 * transport to suppress 4xx noise so genuine 5xx bugs stay visible.
 */
export const isExpectedClientError = (error: unknown): boolean => {
  if (error instanceof ZodError) {
    return true;
  }

  return (
    error instanceof BaseError &&
    error.isOperational &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
};
