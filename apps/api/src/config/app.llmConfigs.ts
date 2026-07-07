/**
 * App-specific LLM call bundles.
 *
 * SETUP: define one named `LlmCallConfig` per LLM task your product runs, then
 * pass it to `generateLlmObject({ config, ... })`. Keeping the knobs here (not
 * inline at call sites) means model + temperature + timeout choices live in one
 * reviewable place.
 *
 * These two are examples for the widget example domain — replace with your own.
 *
 * @module config/app.llmConfigs
 */
import type { LlmCallConfig } from './llmProvider';
import { flashModel } from './llmProvider';

/**
 * Example: generate a short widget description. Fast, cheap, thinking suppressed
 * for latency, tightly bounded output.
 */
export const widgetDescriptionConfig: LlmCallConfig = {
  model: flashModel(),
  temperature: 0.5,
  maxOutputTokens: 300,
  timeoutMs: 8000,
  maxRetries: 2,
  disableThinking: true,
};

/**
 * Example: a slightly larger structured generation with a wider token budget.
 */
export const widgetSummaryConfig: LlmCallConfig = {
  model: flashModel(),
  temperature: 0.4,
  maxOutputTokens: 512,
  timeoutMs: 10000,
  maxRetries: 2,
  disableThinking: true,
};
