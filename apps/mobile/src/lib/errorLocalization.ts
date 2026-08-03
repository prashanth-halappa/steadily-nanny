/**
 * Error Localization Utility
 *
 * Maps API error codes and common transport failures to i18next translation
 * keys in the `errors` namespace, so every error surfaces a localized, friendly
 * message. Product apps add domain-specific keys via the optional `contextKey`
 * override rather than editing this generic table.
 *
 * @module lib/errorLocalization
 */

import { ERROR_CODES } from '@steadily-nanny/shared-types/errorCodes';

type ErrorTFunction = (key: string) => string;

/**
 * Canonical API error codes → i18n keys in the `errors` namespace.
 *
 * Keys expected in your `errors` translation namespace:
 *   validation, unauthorized, forbidden, notFound, conflict, rateLimited,
 *   server, network, offline, timeout, unknown.
 */
export const ERROR_CODE_TO_I18N_KEY: Record<string, string> = {
  [ERROR_CODES.VALIDATION_ERROR]: 'errors:validation',
  [ERROR_CODES.UNAUTHORIZED]: 'errors:unauthorized',
  [ERROR_CODES.FORBIDDEN]: 'errors:forbidden',
  [ERROR_CODES.NOT_FOUND]: 'errors:notFound',
  [ERROR_CODES.CONFLICT]: 'errors:conflict',
  [ERROR_CODES.RATE_LIMITED]: 'errors:rateLimited',
  [ERROR_CODES.INTERNAL_ERROR]: 'errors:server',
  [ERROR_CODES.EXTERNAL_SERVICE_ERROR]: 'errors:server',
};

interface ErrorLike {
  message?: string;
  name?: string;
  isAxiosError?: boolean;
  response?: { status?: number; data?: { error?: { code?: string } } };
}

function asErrorLike(error: unknown): ErrorLike {
  return (error ?? {}) as ErrorLike;
}

/** An axios error with no response never reached the server — treat as offline. */
function isOfflineError(error: ErrorLike): boolean {
  return error.isAxiosError === true && !error.response;
}

/** Network-ish failure detected from the message/name. */
function isNetworkError(error: ErrorLike): boolean {
  const message = (error.message ?? '').toLowerCase();
  const name = (error.name ?? '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    name.includes('network') ||
    name === 'aborterror'
  );
}

/** Timeout failure detected from the message. */
function isTimeoutError(error: ErrorLike): boolean {
  const message = (error.message ?? '').toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
}

/**
 * Pulls the API error code from the standard error ENVELOPE
 * (`error.response.data.error.code`). Note: axios's own top-level `error.code`
 * (e.g. `ERR_NETWORK`) is NOT an API error code and is intentionally ignored —
 * transport failures are classified by shape/message below instead.
 */
function extractErrorCode(error: ErrorLike): string | undefined {
  return error.response?.data?.error?.code;
}

/**
 * Returns a localized error message for a given error.
 *
 * Resolution order:
 * 1. If `contextKey` is provided, use it verbatim (a fully-qualified i18n key,
 *    e.g. `errors:saveProfileFailed`) — the caller owns app-specific copy.
 * 2. If the error carries an API error code, map it to an `errors:*` key.
 * 3. Detect offline / network / timeout by shape and message.
 * 4. Fall back to `errors:unknown`.
 *
 * @param error - The thrown value to localize (any shape).
 * @param t - The i18next translation function.
 * @param contextKey - Optional fully-qualified override key.
 * @returns The localized error message string.
 */
export function getLocalizedErrorMessage(
  error: unknown,
  t: ErrorTFunction,
  contextKey?: string
): string {
  if (contextKey) {
    return t(contextKey);
  }

  const err = asErrorLike(error);

  const errorCode = extractErrorCode(err);
  if (errorCode && ERROR_CODE_TO_I18N_KEY[errorCode]) {
    return t(ERROR_CODE_TO_I18N_KEY[errorCode] as string);
  }

  // Order matters: a realistic axios ERR_NETWORK is `{ isAxiosError: true, no
  // response, message: 'Network Error' }`. Classify it as a network error (by
  // message) BEFORE the generic offline catch-all for axios-with-no-response.
  if (isTimeoutError(err)) {
    return t('errors:timeout');
  }
  if (isNetworkError(err)) {
    return t('errors:network');
  }
  if (isOfflineError(err)) {
    return t('errors:offline');
  }

  return t('errors:unknown');
}

/**
 * Map Supabase Auth / OAuth failures to localized auth copy — never surface
 * raw English backend strings in a bilingual app (Daylight UX #19).
 */
export function getLocalizedAuthErrorMessage(
  error: unknown,
  t: ErrorTFunction
): string {
  const err = asErrorLike(error);
  const message = (err.message ?? '').toLowerCase();

  if (message.includes('invalid login credentials')) {
    return t('auth:errors.invalidCredentials');
  }
  if (
    message.includes('only request this after') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return t('auth:errors.rateLimited');
  }
  if (message.includes('user already registered')) {
    return t('auth:errors.emailTaken');
  }
  if (message.includes('email not confirmed')) {
    return t('auth:errors.emailNotConfirmed');
  }
  if (isTimeoutError(err)) {
    return t('errors:timeout');
  }
  if (isNetworkError(err)) {
    return t('errors:network');
  }
  if (isOfflineError(err)) {
    return t('errors:offline');
  }

  return t('auth:errors.unknown');
}
