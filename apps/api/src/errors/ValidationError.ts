import type { ZodError } from 'zod';
import { BaseError, type ErrorMetadata } from './BaseError';

/**
 * 400 — request validation failed. Generic code is always `VALIDATION_ERROR`.
 * `reason` is a free-form label kept in metadata.
 */
export class ValidationError extends BaseError {
  constructor(
    message: string,
    reason = 'VALIDATION_ERROR',
    statusCode = 400,
    metadata?: ErrorMetadata
  ) {
    super(message, 'VALIDATION_ERROR', statusCode, true, {
      reason,
      ...metadata,
    });
  }

  static fromZodError(zodError: ZodError): ValidationError {
    const formattedErrors = zodError.issues.map(error => ({
      path: error.path.join('.'),
      message: error.message,
      code: error.code,
    }));

    return new ValidationError('Validation failed', 'VALIDATION_ERROR', 400, {
      details: formattedErrors,
    });
  }

  static missingParameter(
    parameterName: string,
    parameterType: 'path' | 'query' | 'body' = 'path'
  ): ValidationError {
    return new ValidationError(
      `Missing required ${parameterType} parameter: ${parameterName}`,
      'MISSING_REQUIRED_FIELD',
      400,
      { parameter: parameterName, type: parameterType }
    );
  }

  static invalidParameter(
    parameterName: string,
    expectedType: string,
    parameterType: 'path' | 'query' | 'body' = 'path'
  ): ValidationError {
    return new ValidationError(
      `Invalid ${parameterType} parameter: ${parameterName} must be a valid ${expectedType}`,
      'INVALID_REQUEST_DATA',
      400,
      { parameter: parameterName, expectedType, type: parameterType }
    );
  }
}
