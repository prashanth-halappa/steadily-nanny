import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 401 — authentication required / failed. The generic error code is always
 * `UNAUTHORIZED`; the optional `reason` is a free-form label (kept in metadata)
 * for finer-grained logging without expanding the generic code set.
 */
export class AuthenticationError extends BaseError {
  constructor(
    message: string,
    reason = 'AUTHENTICATION_REQUIRED',
    metadata?: ErrorMetadata
  ) {
    super(message, 'UNAUTHORIZED', 401, true, { reason, ...metadata });
  }
}
