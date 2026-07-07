import { ERROR_CODES } from '@yourapp/shared-types';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import Sentry, { getFeatureAreaFromPath } from '../config/sentry';
import { BaseError, isExpectedClientError, ValidationError } from '../errors';
import { logError } from './logger';

interface BodyParserErrorInfo {
  statusCode: number;
  name: string;
  code: (typeof ERROR_CODES)['VALIDATION_ERROR'];
  message: string;
}

/**
 * body-parser raises plain Errors (not BaseError/ZodError) tagged via `.type`.
 * Left unhandled they fall into the generic 500 branch and get reported to
 * Sentry as bugs. Map the two client-mistake cases to a 4xx.
 */
function getBodyParserErrorStatus(
  error: Error & { type?: string; status?: number; statusCode?: number }
): BodyParserErrorInfo | null {
  if (error.type === 'entity.too.large') {
    return {
      statusCode: 413,
      name: 'PayloadTooLargeError',
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Request payload is too large',
    };
  }
  if (error.type === 'entity.parse.failed') {
    return {
      statusCode: 400,
      name: 'SyntaxError',
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Request body contains malformed JSON',
    };
  }
  return null;
}

export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const featureArea = getFeatureAreaFromPath(req.path);
  const bodyParserStatus = getBodyParserErrorStatus(error);

  Sentry.withScope(scope => {
    scope.setTag('feature_area', featureArea);
    scope.setTag('request_method', req.method);
    scope.setTag('request_path', req.path);

    // email intentionally omitted (PII minimization)
    if (req.user) {
      scope.setUser({ id: req.user.id });
    }

    scope.setContext('request', {
      url: req.url,
      method: req.method,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      },
      query: req.query,
      requestId: req.id,
    });

    if (error instanceof BaseError) {
      scope.setTag('error_code', error.code);
      scope.setLevel(error.statusCode >= 500 ? 'error' : 'warning');
      if (error.metadata) {
        scope.setContext(
          'error_metadata',
          error.metadata as Record<string, unknown>
        );
      }
    }

    // Skip expected operational 4xx (incl. raw ZodError and body-parser errors)
    // — they are handled flow, not bugs. Reporting them drowns real 5xx.
    if (!isExpectedClientError(error) && !bodyParserStatus) {
      Sentry.captureException(error);
    }
  });

  logError(error, req);

  const createErrorResponse = (
    statusCode: number,
    errorData: Record<string, unknown>
  ) => {
    res.status(statusCode).json({
      success: false,
      error: errorData,
      timestamp: new Date().toISOString(),
      path: req.path,
      requestId: req.id,
    });
  };

  if (bodyParserStatus) {
    createErrorResponse(bodyParserStatus.statusCode, {
      name: bodyParserStatus.name,
      code: bodyParserStatus.code,
      message: bodyParserStatus.message,
    });
    return;
  }

  if (error instanceof ZodError) {
    const validationError = ValidationError.fromZodError(error);
    createErrorResponse(
      validationError.statusCode,
      validationError.toClientJSON().error
    );
    return;
  }

  if (error instanceof BaseError) {
    createErrorResponse(error.statusCode, error.toClientJSON().error);
    return;
  }

  // Heuristic: repository/DB failures that escaped as plain Errors.
  if (
    error.message &&
    (error.message.includes('Failed to') || error.message.includes('Database'))
  ) {
    createErrorResponse(500, {
      name: 'DatabaseError',
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Database operation failed',
    });
    return;
  }

  const internalError = {
    name: 'InternalServerError',
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && {
      details: error.message,
      stack: error.stack,
    }),
  };

  createErrorResponse(500, internalError);
};
