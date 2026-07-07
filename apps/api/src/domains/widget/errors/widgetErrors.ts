/**
 * Widget domain errors.
 *
 * @module domains/widget/errors/widgetErrors
 */
import { NotFoundError } from '../../../errors';
import type { ErrorMetadata } from '../../../errors/BaseError';

/**
 * 404 — the widget does not exist OR is not owned by the caller. Returning the
 * SAME error for "missing" and "not yours" avoids leaking the existence of other
 * users' widgets, and satisfies the ownership-middleware contract (which treats a
 * thrown NotFoundError as the negative — not-owned — case).
 */
export class WidgetNotFoundError extends NotFoundError {
  constructor(widgetId: string, metadata?: ErrorMetadata) {
    super('Widget not found', 'WIDGET_NOT_FOUND', { widgetId, ...metadata });
    this.name = 'WidgetNotFoundError';
  }
}
