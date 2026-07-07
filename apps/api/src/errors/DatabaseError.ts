import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 500 — database operation failed. The generic code is always `INTERNAL_ERROR`
 * (a DB failure is internal from the client's perspective). The 2nd argument is
 * a free-form `reason` label (e.g. 'DATABASE_ERROR', 'CONSTRAINT_VIOLATION')
 * kept in metadata — this lets existing call sites pass a descriptive reason
 * without expanding the generic code set.
 */
export class DatabaseError extends BaseError {
  constructor(
    message: string,
    reason = 'DATABASE_ERROR',
    metadata?: ErrorMetadata
  ) {
    super(message, 'INTERNAL_ERROR', 500, true, { reason, ...metadata });
  }

  static constraint(constraint: string, details?: string): DatabaseError {
    return new DatabaseError(
      `Database constraint violation: ${details || constraint}`,
      'CONSTRAINT_VIOLATION',
      { constraint }
    );
  }

  static connection(details: string): DatabaseError {
    return new DatabaseError(
      `Database connection error: ${details}`,
      'DATABASE_ERROR',
      {
        details,
      }
    );
  }
}
