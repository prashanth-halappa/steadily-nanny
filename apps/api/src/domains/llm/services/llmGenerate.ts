/**
 * Centralized LLM generation helper for structured-output calls.
 *
 * A single, well-tested wrapper around the AI SDK's `generateObject`. Callers
 * pass a pre-built `LlmCallConfig` bundle (from `config/app.llmConfigs`) instead
 * of scattering magic numbers across services. Handles: timeout via
 * AbortController, thinking suppression, PII masking/unmasking, model override,
 * and consistent error triage.
 *
 * @module domains/llm/services/llmGenerate
 */
import type { LanguageModel, LanguageModelUsage } from 'ai';
import { generateObject } from 'ai';
import type { z } from 'zod';
import type { LlmCallConfig } from '../../../config/llmProvider';
import { logger } from '../../../middlewares/logger';
import { maskPII, unmaskObjectPII } from '../../../utils/piiMasking';

/**
 * How the PII name is handled around the LLM call.
 * - `'none'`          — no masking.
 * - `'maskOnly'`      — mask outbound prompt/system but do NOT restore in output.
 * - `'maskAndUnmask'` — mask outbound AND restore the name in the returned object.
 */
export type PiiMode = 'none' | 'maskOnly' | 'maskAndUnmask';

export interface LlmGenerateArgs<T> {
  /** Pre-built configuration bundle (model + per-call knobs). */
  config: LlmCallConfig;
  /** Zod schema describing the expected structured output. */
  schema: z.ZodType<T>;
  /** User prompt sent to the model. */
  prompt: string;
  /** Optional system prompt. */
  system?: string;
  /**
   * When set, this name is masked/unmasked according to `pii`. Ignored when
   * `pii` is `'none'`.
   */
  piiName?: string;
  /** Placeholder used for masking (default `[NAME]`). */
  piiPlaceholder?: string;
  /** PII masking behaviour. Defaults to `'none'`. */
  pii?: PiiMode;
  /** Label for the timeout error message. */
  timeoutLabel?: string;
  /** When set, SUPERSEDES `config.model` for this call. */
  model?: LanguageModel;
}

/** Coarse triage classification for an LLM generation failure. */
export type LlmGenerationErrorType =
  | 'timeout'
  | 'no_object'
  | 'api_error'
  | 'unknown';

export interface LlmGenerationErrorMetadata {
  errorType: LlmGenerationErrorType;
  modelId: string;
  timedOut: boolean;
  timeoutMs?: number;
}

/**
 * Error thrown by {@link generateLlmObject} when structured generation fails.
 * Carries triage metadata and preserves the original SDK error as `cause`.
 */
export class LlmGenerationError extends Error {
  readonly metadata: LlmGenerationErrorMetadata;

  constructor(
    message: string,
    metadata: LlmGenerationErrorMetadata,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'LlmGenerationError';
    this.metadata = metadata;
  }
}

function resolveModelId(model: LanguageModel): string {
  return typeof model === 'string' ? model : model.modelId;
}

function classifyError(
  error: unknown,
  timedOut: boolean
): LlmGenerationErrorType {
  if (timedOut) {
    return 'timeout';
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'AI_NoObjectGeneratedError') {
    return 'no_object';
  }
  if (name === 'AI_APICallError' || name === 'AI_RetryError') {
    return 'api_error';
  }
  return 'unknown';
}

/**
 * Centralized wrapper around `generateObject` for structured output.
 *
 * @returns `{ object, usage }` on success.
 * @throws {LlmGenerationError} on failure (carrying triage metadata + cause).
 */
export async function generateLlmObject<T>(
  args: LlmGenerateArgs<T>
): Promise<{ object: T; usage: LanguageModelUsage }> {
  const {
    config,
    schema,
    prompt,
    system,
    piiName,
    piiPlaceholder,
    pii = 'none',
    timeoutLabel = 'LLM generation',
    model: overrideModel,
  } = args;

  const effectiveModel = overrideModel ?? config.model;
  const maskOptions = { placeholder: piiPlaceholder };

  // ── PII masking ──────────────────────────────────────────────────────────
  const shouldMask =
    (pii === 'maskOnly' || pii === 'maskAndUnmask') && piiName !== undefined;
  const maskedPrompt = shouldMask
    ? maskPII(prompt, piiName, maskOptions)
    : prompt;
  const maskedSystem =
    shouldMask && system !== undefined
      ? maskPII(system, piiName, maskOptions)
      : system;

  // ── Timeout (only when timeoutMs is configured) ───────────────────────────
  let timedOut = false;
  let abortController: AbortController | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (config.timeoutMs !== undefined) {
    abortController = new AbortController();
    timeoutId = setTimeout(() => {
      timedOut = true;
      abortController?.abort(new Error(`${timeoutLabel} timed out`));
    }, config.timeoutMs);
  }

  try {
    const result = await generateObject({
      model: effectiveModel,
      schema,
      prompt: maskedPrompt,
      system: maskedSystem,
      maxRetries: config.maxRetries,
      ...(config.temperature !== undefined
        ? { temperature: config.temperature }
        : {}),
      ...(config.maxOutputTokens !== undefined
        ? { maxOutputTokens: config.maxOutputTokens }
        : {}),
      ...(abortController !== undefined
        ? { abortSignal: abortController.signal }
        : {}),
      ...(config.disableThinking
        ? {
            providerOptions: {
              vertex: { thinkingConfig: { thinkingBudget: 0 } },
            },
          }
        : {}),
    });

    const object =
      pii === 'maskAndUnmask' && piiName !== undefined
        ? unmaskObjectPII(result.object as T, piiName, maskOptions)
        : (result.object as T);

    return { object, usage: result.usage };
  } catch (error) {
    const errorType = classifyError(error, timedOut);
    const message =
      timedOut && !(error instanceof LlmGenerationError)
        ? `${timeoutLabel} timed out after ${config.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new LlmGenerationError(
      message,
      {
        errorType,
        modelId: resolveModelId(effectiveModel),
        timedOut,
        ...(config.timeoutMs !== undefined
          ? { timeoutMs: config.timeoutMs }
          : {}),
      },
      { cause: error }
    );
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Emit a consistent, triage-friendly warning when LLM generation fails and a
 * fallback is used.
 */
export function logLlmGenerationFailure(
  context: Record<string, unknown>,
  error: unknown
): void {
  const metadata =
    error instanceof LlmGenerationError ? error.metadata : undefined;
  logger.warn('LLM generation failed, using fallback', {
    ...context,
    errorType: metadata?.errorType ?? 'unknown',
    modelId: metadata?.modelId,
    timedOut: metadata?.timedOut ?? false,
    error: error instanceof Error ? error.message : String(error),
  });
}
