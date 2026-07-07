/**
 * Widget command service (CQRS-lite: writes). Owns the business rules that make
 * the widget domain a kitchen-sink for the kit's infrastructure:
 *
 *  - entitlement GATING (atomic quota consume) on create and on LLM generation,
 *  - LLM description generation with PII masking + graceful degradation,
 *  - a push notification to the owner's own deliverable devices.
 *
 * The repository + query service are injectable so unit tests can pass mocks.
 *
 * @module domains/widget/services/widgetCommandService
 */
import { widgetDescriptionConfig } from '../../../config/app.llmConfigs';
import {
  generateLlmObject,
  LlmGenerationError,
  logLlmGenerationFailure,
} from '../../llm/services/llmGenerate';
import { sendToUser } from '../../notification/services/pushDispatchService';
import type { SendResult } from '../../notification/types';
import { EntitlementGatingService } from '../../subscription/services/entitlementGatingService';
import { WidgetRepository } from '../repositories/widgetRepository';
import { WidgetDescriptionSchema } from '../schemas';
import type {
  CreateWidgetInput,
  UpdateWidgetInput,
  Widget,
  WidgetDescription,
} from '../types';
import {
  type WidgetQueryService,
  widgetQueryService,
} from './widgetQueryService';

export class WidgetCommandService {
  constructor(
    private readonly repo: WidgetRepository = new WidgetRepository(),
    private readonly queries: WidgetQueryService = widgetQueryService
  ) {}

  /**
   * Create a widget owned by the caller. GATED: atomically consumes one
   * `widget_creation` unit BEFORE the insert — a paywall/limit throws
   * PaywallRequiredError (402) / UsageLimitExceededError (429) and no row is
   * created.
   */
  async create(ownerId: string, input: CreateWidgetInput): Promise<Widget> {
    await EntitlementGatingService.requireUsageQuota(
      ownerId,
      'widget_creation'
    );
    return this.repo.create({
      owner_id: ownerId,
      name: input.name,
      description: null,
      tags: [],
    });
  }

  /** Update a widget's mutable fields (ownership enforced first). */
  async update(
    ownerId: string,
    widgetId: string,
    input: UpdateWidgetInput
  ): Promise<Widget> {
    await this.queries.getOwned(ownerId, widgetId);
    return this.repo.update(widgetId, input);
  }

  /** Delete a widget (ownership enforced first). */
  async delete(ownerId: string, widgetId: string): Promise<void> {
    await this.queries.getOwned(ownerId, widgetId);
    await this.repo.delete(widgetId);
  }

  /**
   * Generate an AI description + tags for a widget. GATED by `llm_generation`.
   * Demonstrates PII masking (the owner's display name is masked in the outbound
   * prompt and restored in the output) and graceful degradation (an
   * LlmGenerationError never 5xxes — it falls back to a deterministic
   * description, which a retry/batch job could later improve on).
   */
  async generateDescription(
    ownerId: string,
    widgetId: string,
    ownerDisplayName: string
  ): Promise<Widget> {
    const widget = await this.queries.getOwned(ownerId, widgetId);
    await EntitlementGatingService.requireUsageQuota(ownerId, 'llm_generation');

    const generated = await this.callLlm(widget.name, ownerDisplayName);

    return this.repo.update(widgetId, {
      description: generated.description,
      tags: generated.tags,
    });
  }

  /** Send a "widget ready" push to the owner's own deliverable devices. */
  async notify(ownerId: string, widgetId: string): Promise<SendResult> {
    const widget = await this.queries.getOwned(ownerId, widgetId);
    return sendToUser(ownerId, {
      title: 'Widget ready',
      body: `"${widget.name}" is ready to view.`,
      // Deep-link payload — resolveNotificationHref maps `widget_ready` to the
      // widget detail route (see the mobile push routeMap).
      data: { type: 'widget_ready', widgetId },
    });
  }

  /**
   * The actual LLM call, isolated for graceful degradation: on any
   * LlmGenerationError it logs and returns a deterministic fallback so the caller
   * always gets a valid result (HTTP 200), never a 5xx.
   */
  private async callLlm(
    widgetName: string,
    ownerDisplayName: string
  ): Promise<WidgetDescription> {
    const prompt =
      `Write a warm one-sentence description and up to 3 short lowercase tags ` +
      `for a widget called "${widgetName}", created by ${ownerDisplayName}.`;

    try {
      const { object } = await generateLlmObject<WidgetDescription>({
        config: widgetDescriptionConfig,
        schema: WidgetDescriptionSchema,
        prompt,
        // PII: mask the owner's name before the call, restore it in the output.
        piiName: ownerDisplayName,
        pii: 'maskAndUnmask',
        timeoutLabel: 'widget description',
      });
      return object;
    } catch (error) {
      if (error instanceof LlmGenerationError) {
        logLlmGenerationFailure(
          { operation: 'widgetDescription', widgetName },
          error
        );
        return { description: `A widget called "${widgetName}".`, tags: [] };
      }
      throw error;
    }
  }
}

// Singleton for controllers that don't need DI.
export const widgetCommandService = new WidgetCommandService();
