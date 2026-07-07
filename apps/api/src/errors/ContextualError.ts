/**
 * Abstract base for errors that carry structured context and support context
 * sanitization. Extends BaseError with a typed `context` object and an
 * overridable `sanitizeContext()` hook for redacting sensitive fields.
 */
import type { ErrorCode } from '@yourapp/shared-types';
import { BaseError } from './BaseError';

export abstract class ContextualError<
  TContext = Record<string, unknown>,
> extends BaseError {
  public readonly context: TContext;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    context: TContext
  ) {
    super(message, code, statusCode);
    this.context = context;
  }

  public override toJSON() {
    return {
      ...super.toJSON(),
      context: this.sanitizeContext(),
    };
  }

  /** Override to redact sensitive fields before serialization. */
  protected sanitizeContext(): TContext {
    return this.context;
  }
}
