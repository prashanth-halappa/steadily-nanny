/**
 * App-specific LLM call bundles.
 *
 * SETUP: define one named `LlmCallConfig` per LLM task your product runs, then
 * pass it to `generateLlmObject({ config, ... })`. Keeping the knobs here (not
 * inline at call sites) means model + temperature + timeout choices live in one
 * reviewable place.
 *
 * Example shape (see `./llmProvider`'s `LlmCallConfig` for every field):
 *
 * ```ts
 * import type { LlmCallConfig } from './llmProvider';
 * import { flashModel } from './llmProvider';
 *
 * export const myTaskConfig: LlmCallConfig = {
 *   model: flashModel(),
 *   temperature: 0.5,
 *   maxOutputTokens: 300,
 *   timeoutMs: 8000,
 *   maxRetries: 2,
 *   disableThinking: true,
 * };
 * ```
 *
 * Choose `disableThinking` and `timeoutMs`/`maxRetries` deliberately for every
 * new bundle — Gemini's "thinking" pass silently adds seconds of latency to
 * structured-output calls, and an unbounded retry budget can blow through your
 * latency target via the SDK's own backoff (GOLDEN-FIX #10).
 *
 * @module config/app.llmConfigs
 */
export {};
