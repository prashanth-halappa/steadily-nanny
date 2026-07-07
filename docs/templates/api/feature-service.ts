/**
 * Service skeleton — business logic for the `<feature>` domain.
 * Lives at: apps/api/src/domains/<feature>/services/<feature>Service.ts
 *
 * The service holds ALL business logic and is the only layer that talks to
 * repositories. CQRS-lite: in larger domains split into <feature>QueryService
 * (reads) and <feature>CommandService (writes). Here they're combined for brevity.
 *
 * Authorization rule: every method that touches a user-owned resource must verify
 * ownership BEFORE acting. Throw a typed error; the global handler maps it to HTTP.
 */

import { WidgetRepository } from '../repositories/widgetRepository';
import { NotFoundError, ForbiddenError } from '../../../errors';
import type { Widget } from '@yourapp/shared-types/dto/widget.dto';
import type { CreateWidgetInput } from '@yourapp/shared-types/schemas/widget.schema';

export class WidgetService {
  // Inject the repo so unit tests can pass a mock; default to the real one.
  constructor(private readonly repo: WidgetRepository = new WidgetRepository()) {}

  /** READ — list the caller's own widgets. */
  async listForOwner(ownerId: string): Promise<Widget[]> {
    return this.repo.findByOwnerId(ownerId);
  }

  /** READ — fetch one, enforcing ownership. */
  async getOwned(ownerId: string, widgetId: string): Promise<Widget> {
    const widget = await this.repo.findById(widgetId);
    if (!widget) throw new NotFoundError('Widget not found', 'WIDGET_NOT_FOUND', { widgetId });
    if (widget.owner_id !== ownerId) {
      throw new ForbiddenError('Not your widget', 'WIDGET_FORBIDDEN', { widgetId, ownerId });
    }
    return widget;
  }

  /** WRITE — create owned by the caller. */
  async create(ownerId: string, input: CreateWidgetInput): Promise<Widget> {
    return this.repo.create({ ...input, owner_id: ownerId });
  }
}

// Export a singleton for controllers that don't need DI.
export const widgetService = new WidgetService();
