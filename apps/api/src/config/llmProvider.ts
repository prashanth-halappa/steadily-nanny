/**
 * LLM provider setup — the model registry.
 *
 * Instantiates the Vertex AI provider ONCE (auth via Application Default
 * Credentials — no API key) and exports named, tier-based model factories.
 * Call sites import a meaningfully-named model, never a raw model string, so
 * model choices are centralized and swappable in one file.
 *
 * The provider-agnostic patterns (tiered registry, `LlmCallConfig` bundle) carry
 * over to any provider — swap `@ai-sdk/google-vertex` and the model ids.
 *
 * @module config/llmProvider
 */
import { createVertex } from '@ai-sdk/google-vertex';
import type { LanguageModel } from 'ai';
import { env } from './env';

// Vertex AI provider — ADC auth, not an API key. Same Gemini model ids as the
// AI Studio provider.
//
// GOOGLE_VERTEX_PROJECT is optional at boot (env.core.ts) since no domain
// currently calls into this module. Built lazily, on first model-factory call,
// so a missing project fails with a clear error naming the var right here —
// not an opaque SDK failure (createVertex silently falls back to reading
// GOOGLE_VERTEX_PROJECT off process.env itself when the passed value is
// undefined, which would otherwise mask a misconfigured deploy).
let vertex: ReturnType<typeof createVertex> | undefined;

function getVertex(): ReturnType<typeof createVertex> {
  if (!vertex) {
    if (!env.GOOGLE_VERTEX_PROJECT) {
      throw new Error(
        'GOOGLE_VERTEX_PROJECT is required to use LLM features — set it in your environment before calling an llmProvider model factory.'
      );
    }
    vertex = createVertex({
      project: env.GOOGLE_VERTEX_PROJECT,
      location: env.GOOGLE_VERTEX_LOCATION,
    });
  }
  return vertex;
}

// ── Tiers — pick the cheapest model that meets the task's accuracy/latency bar.
/** Cheapest + fastest; trivial, high-volume generations. */
export const flashLiteModel = (): LanguageModel =>
  getVertex()('gemini-2.5-flash-lite');
/** Default workhorse; fast + cheap for latency-sensitive, moderate-accuracy work. */
export const flashModel = (): LanguageModel => getVertex()('gemini-2.5-flash');
/** Slower + pricier; reserved for complex/high-stakes synthesis or classification. */
export const proModel = (): LanguageModel => getVertex()('gemini-2.5-pro');

/** Embedding model for semantic-similarity features. */
export const embeddingModel = () =>
  getVertex().embeddingModel('gemini-embedding-001');

// ── Centralized LLM call configuration ───────────────────────────────────────

/**
 * All configuration knobs for a single structured-output LLM call. Bundles the
 * model instance with per-call parameters so callers never scatter magic numbers
 * across services. Build named bundles in `app.llmConfigs.ts`.
 */
export interface LlmCallConfig {
  /** The LanguageModel instance to use. */
  model: LanguageModel;
  /** Sampling temperature (omit for model default). */
  temperature?: number;
  /** Maximum output tokens (omit for model default). */
  maxOutputTokens?: number;
  /**
   * Hard wall-clock timeout in ms. When defined, an AbortController is wired up
   * and the request is cancelled when the deadline elapses. When undefined, no
   * AbortController is created.
   */
  timeoutMs?: number;
  /** Number of SDK-level retries on transient errors. */
  maxRetries: number;
  /**
   * When true, disables Gemini's dynamic "thinking" pass (thinkingBudget: 0).
   * Set false for pro-model calls that need a reasoning pass. Essential for
   * latency-sensitive fast paths — thinking adds several seconds.
   */
  disableThinking: boolean;
}
