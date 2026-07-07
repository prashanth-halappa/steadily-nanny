/**
 * Analytics Plugins
 *
 * Export all plugin factories and default instances.
 */

import type { ZodSchema } from 'zod';
import { createEnrichmentPlugin, enrichmentPlugin } from './enrichmentPlugin';
import {
  createLoggingPlugin,
  type LoggingPluginOptions,
  loggingPlugin,
} from './loggingPlugin';
import type { AnalyticsPlugin } from './types';
import {
  createValidationPlugin,
  type ValidationPlugin,
  type ValidationPluginOptions,
  validationPlugin,
} from './validationPlugin';

// Re-export types
export type {
  AnalyticsContext,
  AnalyticsEvent,
  AnalyticsPlugin,
} from './types';
// Re-export plugin factories and default instances
export {
  createEnrichmentPlugin,
  createLoggingPlugin,
  createValidationPlugin,
  enrichmentPlugin,
  type LoggingPluginOptions,
  loggingPlugin,
  type ValidationPlugin,
  type ValidationPluginOptions,
  validationPlugin,
};

/**
 * Create default plugin set
 *
 * @param options Configuration options
 * @returns Array of default plugins (enrichment, logging, validation)
 */
export function createDefaultPlugins(options?: {
  enableLogging?: boolean;
  enableValidation?: boolean;
  validationSchemas?: Record<string, ZodSchema>;
}): AnalyticsPlugin[] {
  const {
    enableLogging = __DEV__,
    enableValidation = __DEV__,
    validationSchemas = {},
  } = options ?? {};

  return [
    createEnrichmentPlugin(),
    createLoggingPlugin({ enabled: enableLogging }),
    createValidationPlugin({
      enabled: enableValidation,
      schemas: validationSchemas,
    }),
  ];
}
