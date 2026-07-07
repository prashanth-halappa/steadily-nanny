import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 404 — resource not found. Generic code is always `NOT_FOUND`; `reason` is a
 * free-form label kept in metadata.
 */
export class NotFoundError extends BaseError {
  constructor(message: string, reason = 'NOT_FOUND', metadata?: ErrorMetadata) {
    super(message, 'NOT_FOUND', 404, true, { reason, ...metadata });
  }

  /** Factory for a "<Type> with ID <id> not found" error. */
  static resource(resourceType: string, id: string): NotFoundError {
    return new NotFoundError(
      `${resourceType} with ID ${id} not found`,
      'RESOURCE_NOT_FOUND',
      { resourceType, id }
    );
  }
}
