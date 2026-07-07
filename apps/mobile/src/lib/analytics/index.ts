/**
 * Analytics Module Index
 *
 * Central export point for all analytics functionality.
 * Import analytics utilities from this file throughout the app.
 */

// Module-level singleton (track outside React) + shared PostHog client
export { analytics } from './analytics';
export { posthogClient } from './client';

export { AnalyticsContext as AnalyticsReactContext } from './core/AnalyticsContext';
// Provider
export { AnalyticsProvider } from './core/AnalyticsProvider';
// Core types
export type {
  AnalyticsConfig,
  AnalyticsContext,
  AnalyticsContextValue,
  AnalyticsEvent,
  AnalyticsPlugin,
  AnalyticsProviderProps,
  UseTrackMutationOptions,
} from './core/types';
// Event constants
export * from './events';
// Hooks
export {
  useAnalytics,
  useIdentifyUser,
  useTrackMutation,
  useTrackScreen,
} from './hooks';
// Plugins
export {
  createDefaultPlugins,
  createEnrichmentPlugin,
  createLoggingPlugin,
  createValidationPlugin,
  enrichmentPlugin,
  loggingPlugin,
  validationPlugin,
} from './plugins';

// Property builders and types
export * from './properties';

// Low-level tracking functions
export * from './tracking';
