import type { ErrorCode } from '@yourapp/shared-types';

export interface ErrorMetadata {
  [key: string]: unknown;
}

/**
 * Abstract base for all application errors. Carries a machine-readable
 * `code` (one of the generic ERROR_CODES), an HTTP `statusCode`, an
 * `isOperational` flag, and optional `metadata`.
 */
export abstract class BaseError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly metadata?: ErrorMetadata;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode = 500,
    isOperational = true,
    metadata?: ErrorMetadata
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.metadata = metadata;

    Error.captureStackTrace(this, this.constructor);
  }

  /** Full serialization for logs/Sentry (includes metadata + stack). */
  public toJSON() {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        ...(this.metadata && { metadata: this.metadata }),
      },
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      stack: this.stack,
    };
  }

  /**
   * Client-safe serialization. Never exposes `metadata` for 5xx/internal errors
   * (which may hold raw DB/error internals). 4xx operational errors keep
   * `metadata` — those are built by request-handling code specifically to inform
   * the caller (validation issues, retry fields), so they are client-safe by
   * construction.
   */
  public toClientJSON() {
    const isClientSafeStatus = this.statusCode < 500;
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        ...(isClientSafeStatus && this.metadata && { metadata: this.metadata }),
      },
      statusCode: this.statusCode,
      isOperational: this.isOperational,
    };
  }
}
