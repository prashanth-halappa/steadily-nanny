import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 403 — authenticated but not permitted. The generic error code is always
 * `FORBIDDEN`; `reason` is a free-form label kept in metadata.
 */
export class AuthorizationError extends BaseError {
  constructor(message: string, reason = 'FORBIDDEN', metadata?: ErrorMetadata) {
    super(message, 'FORBIDDEN', 403, true, { reason, ...metadata });
  }
}
