/**
 * Validation Plugin
 *
 * Validates analytics event properties against Zod schemas.
 * Non-blocking: logs warnings but still allows events through.
 * Enabled by default in development mode (__DEV__).
 *
 * @example
 * ```tsx
 * import { z } from 'zod';
 *
 * const schemas = {
 *   widget_created: z.object({
 *     widget_id: z.string(),
 *     source: z.string().optional(),
 *   }),
 * };
 *
 * <AnalyticsProvider plugins={[createValidationPlugin({ enabled: __DEV__, schemas })]}>
 *   {children}
 * </AnalyticsProvider>
 * ```
 */

import type { ZodSchema } from 'zod';
import type {
  AnalyticsContext,
  AnalyticsEvent,
  AnalyticsPlugin,
} from '../core/types';

/**
 * Validation plugin configuration options
 */
export interface ValidationPluginOptions {
  /** Whether validation is enabled */
  enabled?: boolean;

  /** Map of event names to Zod schemas */
  schemas: Record<string, ZodSchema>;
}

/**
 * Extended plugin interface with addSchema method
 */
export interface ValidationPlugin extends AnalyticsPlugin {
  /** Dynamically add a schema for an event */
  addSchema?: (eventName: string, schema: ZodSchema) => void;
}

/**
 * Create a validation plugin instance
 *
 * @param options Configuration options
 * @returns Validation plugin that checks event properties
 */
export function createValidationPlugin(
  options: ValidationPluginOptions
): ValidationPlugin {
  const { enabled = __DEV__, schemas } = options;

  // Mutable schemas map for dynamic additions
  const schemaMap = new Map<string, ZodSchema>(Object.entries(schemas));

  return {
    name: 'validation',

    beforeTrack(
      event: AnalyticsEvent,
      _context: AnalyticsContext
    ): AnalyticsEvent {
      if (!enabled) {
        return event;
      }

      const schema = schemaMap.get(event.name);

      if (!schema) {
        // No schema registered for this event, allow through
        return event;
      }

      // Validate properties against schema
      const result = schema.safeParse(event.properties ?? {});

      if (!result.success) {
        // Log validation error but don't block the event
        console.warn(`Analytics Validation Error: ${event.name}`, {
          errors: result.error.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          properties: event.properties,
        });
      }

      // Always return event (non-blocking validation)
      return event;
    },

    /**
     * Add a schema dynamically
     */
    addSchema(eventName: string, schema: ZodSchema): void {
      schemaMap.set(eventName, schema);
    },
  };
}

/**
 * Default validation plugin instance with empty schemas
 * Add schemas via addSchema or create a new instance with schemas
 */
export const validationPlugin = createValidationPlugin({
  schemas: {},
});
