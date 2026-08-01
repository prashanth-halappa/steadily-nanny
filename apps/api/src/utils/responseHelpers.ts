import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  ErrorCode,
  ValidationErrorDetail,
} from '@steadily-nanny/shared-types';
import type { Response } from 'express';
import type { ZodError } from 'zod';

/** Build a standardized success envelope. */
export function createSuccessResponse<T>(
  message: string,
  data: T,
  requestId: string
): ApiSuccessResponse<T> {
  return {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
    requestId,
  };
}

/** Build a standardized error envelope. */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  path: string,
  requestId: string,
  details?: ValidationErrorDetail[] | Record<string, unknown>,
  field?: string
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
      ...(field && { field }),
    },
    timestamp: new Date().toISOString(),
    path,
    requestId,
  };
}

/** Build a validation-error envelope from a ZodError. */
export function createValidationErrorResponse(
  zodError: ZodError,
  path: string,
  requestId: string
): ApiErrorResponse {
  const details: ValidationErrorDetail[] = zodError.issues.map(error => ({
    path: [...error.path] as (string | number)[],
    message: error.message,
    code: error.code,
    ...('received' in error &&
      error.received !== undefined && { received: error.received }),
    ...('expected' in error &&
      error.expected !== undefined && { expected: error.expected }),
  }));

  return createErrorResponse(
    'VALIDATION_ERROR',
    'Invalid request data',
    path,
    requestId,
    details
  );
}

/** Send a success response. */
export function sendSuccessResponse<T>(
  res: Response,
  message: string,
  data: T,
  statusCode = 200
): Response {
  const requestId = res.locals?.requestId || 'unknown';
  return res
    .status(statusCode)
    .json(createSuccessResponse(message, data, requestId));
}

/** Send an error response. */
export function sendErrorResponse(
  res: Response,
  code: ErrorCode,
  message: string,
  statusCode = 500,
  details?: ValidationErrorDetail[] | Record<string, unknown>,
  field?: string
): Response {
  const requestId = res.locals?.requestId || 'unknown';
  const path = res.req?.path || 'unknown';
  return res
    .status(statusCode)
    .json(createErrorResponse(code, message, path, requestId, details, field));
}

/** Send a validation-error response from a ZodError. */
export function sendValidationErrorResponse(
  res: Response,
  zodError: ZodError,
  statusCode = 400
): Response {
  const requestId = res.locals?.requestId || 'unknown';
  const path = res.req?.path || 'unknown';
  return res
    .status(statusCode)
    .json(createValidationErrorResponse(zodError, path, requestId));
}
