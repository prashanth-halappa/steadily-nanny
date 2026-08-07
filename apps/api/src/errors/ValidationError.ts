import type { ZodError } from 'zod';
import { BaseError, type ErrorMetadata } from './BaseError';

/** How many failing fields the top-level message names before it truncates. */
const MAX_SUMMARISED_ISSUES = 3;

/**
 * Fold the failing paths into one readable line. The message used to be the
 * bare constant `Validation failed`, which named no field at all — the
 * per-field `details` were already in the metadata, but the message is what a
 * log line, a Sentry title and an integrator's console show FIRST, so a 400
 * was effectively hintless. Capped so a large body's rejection stays one line.
 */
function summarise(issues: { path: string; message: string }[]): string {
  if (issues.length === 0) return 'Validation failed';
  const named = issues
    .slice(0, MAX_SUMMARISED_ISSUES)
    .map(issue => `${issue.path || '(root)'} (${issue.message})`)
    .join(', ');
  const hidden = issues.length - MAX_SUMMARISED_ISSUES;
  return `Validation failed: ${named}${hidden > 0 ? ` (+${hidden} more)` : ''}`;
}

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

    return new ValidationError(
      summarise(formattedErrors),
      'VALIDATION_ERROR',
      400,
      { details: formattedErrors }
    );
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
