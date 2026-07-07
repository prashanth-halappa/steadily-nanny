/**
 * Logging Plugin
 *
 * Logs all analytics events to the console for debugging.
 * Enabled by default in development mode (__DEV__).
 *
 * @example
 * ```tsx
 * <AnalyticsProvider plugins={[createLoggingPlugin({ enabled: __DEV__ })]}>
 *   {children}
 * </AnalyticsProvider>
 * ```
 */

import type {
  AnalyticsContext,
  AnalyticsEvent,
  AnalyticsPlugin,
} from '../core/types';

/**
 * Logging plugin configuration options
 */
export interface LoggingPluginOptions {
  /** Whether logging is enabled */
  enabled?: boolean;
}

/**
 * Create a logging plugin instance
 *
 * @param options Configuration options
 * @returns Logging plugin that outputs events to console
 */
export function createLoggingPlugin(
  options: LoggingPluginOptions = {}
): AnalyticsPlugin {
  const { enabled = __DEV__ } = options;

  return {
    name: 'logging',

    beforeTrack(
      event: AnalyticsEvent,
      _context: AnalyticsContext
    ): AnalyticsEvent {
      if (enabled) {
        console.log(`Analytics Event: ${event.name}`, event.properties ?? {});
      }
      return event;
    },

    afterTrack(_event: AnalyticsEvent, _context: AnalyticsContext): void {
      // Optional: Log after tracking completes
      // Useful for confirming events were sent
    },

    onError(error: Error, event: AnalyticsEvent): void {
      if (enabled) {
        console.error(`Analytics Error: ${event.name}`, {
          error: error.message,
          event,
        });
      }
    },
  };
}

/**
 * Default logging plugin instance (enabled in development)
 */
export const loggingPlugin = createLoggingPlugin();
