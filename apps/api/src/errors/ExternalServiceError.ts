import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 5xx — a downstream/external service failed. Generic code is always
 * `EXTERNAL_SERVICE_ERROR`; `reason` is a free-form label kept in metadata.
 */
export class ExternalServiceError extends BaseError {
  constructor(
    message: string,
    reason = 'EXTERNAL_SERVICE_ERROR',
    statusCode = 502,
    metadata?: ErrorMetadata
  ) {
    super(message, 'EXTERNAL_SERVICE_ERROR', statusCode, true, {
      reason,
      ...metadata,
    });
  }

  static timeout(service: string, operation: string): ExternalServiceError {
    return new ExternalServiceError(
      `${service} service timeout during ${operation}`,
      'SERVICE_UNAVAILABLE',
      503,
      { service, operation }
    );
  }

  static unavailable(service: string, reason?: string): ExternalServiceError {
    return new ExternalServiceError(
      `${service} service unavailable${reason ? `: ${reason}` : ''}`,
      'SERVICE_UNAVAILABLE',
      503,
      { service, detail: reason }
    );
  }
}
