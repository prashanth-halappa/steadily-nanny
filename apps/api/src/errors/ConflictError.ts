import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 409 — conflict / duplicate resource. Generic code is always `CONFLICT`;
 * `reason` is a free-form label kept in metadata.
 */
export class ConflictError extends BaseError {
  constructor(
    message: string,
    reason = 'DUPLICATE_RESOURCE',
    metadata?: ErrorMetadata
  ) {
    super(message, 'CONFLICT', 409, true, { reason, ...metadata });
  }

  static duplicate(
    resourceType: string,
    field: string,
    value: string
  ): ConflictError {
    return new ConflictError(
      `${resourceType} with ${field} '${value}' already exists`,
      'DUPLICATE_RESOURCE',
      { resourceType, field, value }
    );
  }
}
