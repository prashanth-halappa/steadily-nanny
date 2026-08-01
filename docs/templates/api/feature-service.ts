/**
 * Service skeleton — business logic for the `<feature>` domain.
 * Lives at: apps/api/src/domains/<feature>/services/<feature>Service.ts
 *
 * The service holds ALL business logic and is the only layer that talks to
 * repositories. CQRS-lite: in larger domains split into <feature>QueryService
 * (reads) and <feature>CommandService (writes) — see the realized
 * `apps/api/src/domains/widget/services/` for a worked example. Here they're
 * combined for brevity.
 *
 * Ownership rule: `getOwned` throws the SAME NotFoundError for "doesn't exist"
 * and "not yours" — this is deliberate (it avoids leaking whether a resource
 * exists to a caller who doesn't own it) and it's the exact contract the
 * `authWithOwnership` preset's `lookup` function requires (see
 * `apps/api/src/middlewares/validateResourceOwnership.ts`): the lookup MUST
 * throw a NotFoundError for both cases, never a distinct "forbidden" error.
 * There is no `ForbiddenError` class in this codebase — see
 * `apps/api/src/errors/` for the full list (`AuthorizationError` is the closest
 * generic one, used for auth-failure cases, not ownership mismatches).
 */

import type { CreateWidgetInput, Widget } from '@steadily-nanny/shared-types/schemas/widget.schema';
import { NotFoundError } from '../../../errors';
import { WidgetRepository } from '../repositories/widgetRepository';

export class WidgetService {
  // Inject the repo so unit tests can pass a mock; default to the real one.
  constructor(
    private readonly repo: WidgetRepository = new WidgetRepository()
  ) {}

  /** READ — list the caller's own widgets. */
  async listForOwner(ownerId: string): Promise<Widget[]> {
    return this.repo.findByOwnerId(ownerId);
  }

  /** READ — fetch one, enforcing ownership (see the class doc comment above). */
  async getOwned(ownerId: string, widgetId: string): Promise<Widget> {
    const widget = await this.repo.findById(widgetId);
    if (!widget || widget.owner_id !== ownerId) {
      throw new NotFoundError('Widget not found', 'WIDGET_NOT_FOUND', {
        widgetId,
      });
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
