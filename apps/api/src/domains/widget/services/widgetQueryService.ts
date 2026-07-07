/**
 * Widget query service (CQRS-lite: reads only). Enforces ownership before
 * returning a single widget. The repository is injectable so unit tests can pass
 * a mock.
 *
 * @module domains/widget/services/widgetQueryService
 */
import { WidgetNotFoundError } from '../errors/widgetErrors';
import { WidgetRepository } from '../repositories/widgetRepository';
import type { Widget } from '../types';

export class WidgetQueryService {
  constructor(
    private readonly repo: WidgetRepository = new WidgetRepository()
  ) {}

  /** List the caller's own widgets. */
  async listForOwner(ownerId: string): Promise<Widget[]> {
    return this.repo.findByOwnerId(ownerId);
  }

  /**
   * Fetch one widget, enforcing ownership. Throws WidgetNotFoundError for both a
   * missing widget and one owned by someone else (no existence leak). This is the
   * `lookup` the ownership middleware calls on /:widgetId routes.
   */
  async getOwned(ownerId: string, widgetId: string): Promise<Widget> {
    const widget = await this.repo.findById(widgetId);
    if (!widget || widget.owner_id !== ownerId) {
      throw new WidgetNotFoundError(widgetId);
    }
    return widget;
  }

  /** Count widgets created since an ISO timestamp (used by the digest job). */
  async countCreatedSince(sinceIso: string): Promise<number> {
    return this.repo.countCreatedSince(sinceIso);
  }
}

// Singleton for controllers/routes that don't need DI.
export const widgetQueryService = new WidgetQueryService();
