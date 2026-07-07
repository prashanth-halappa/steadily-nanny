/**
 * Enrichment Plugin
 *
 * Automatically enriches all analytics events with context data:
 * - User ID
 * - Entity ID + bucket (your app's primary tracked object)
 * - Screen name, previous screen
 * - Device platform, model
 *
 * This ensures consistent context across all tracked events. Explicit event
 * properties always win over enrichment.
 */

import type {
  AnalyticsContext,
  AnalyticsEvent,
  AnalyticsPlugin,
} from '../core/types';

/**
 * Create an enrichment plugin instance
 *
 * @returns Enrichment plugin that adds context to all events
 */
export function createEnrichmentPlugin(): AnalyticsPlugin {
  return {
    name: 'enrichment',

    beforeTrack(
      event: AnalyticsEvent,
      context: AnalyticsContext
    ): AnalyticsEvent {
      // Build enrichment properties from context
      const enrichment: Record<string, unknown> = {};

      // Add user context
      if (context.user?.id) {
        enrichment.user_id = context.user.id;
      }

      // Add entity context
      if (context.entity?.id) {
        enrichment.entity_id = context.entity.id;
      }
      if (context.entity?.bucket) {
        enrichment.entity_bucket = context.entity.bucket;
      }

      // Add screen context
      if (context.screen?.current) {
        enrichment.screen_name = context.screen.current;
      }
      if (context.screen?.previous) {
        enrichment.previous_screen = context.screen.previous;
      }

      // Add device context
      if (context.device?.platform) {
        enrichment.platform = context.device.platform;
      }
      if (context.device?.model) {
        enrichment.device_model = context.device.model;
      }

      // If no enrichment needed, return event as-is
      if (Object.keys(enrichment).length === 0) {
        return event;
      }

      // Merge enrichment with existing properties
      // Existing properties take precedence (don't override explicit values)
      return {
        ...event,
        properties: {
          ...enrichment,
          ...(event.properties ?? {}),
        },
      };
    },
  };
}

/**
 * Default enrichment plugin instance
 */
export const enrichmentPlugin = createEnrichmentPlugin();
