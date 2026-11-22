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
  // Not in shared-types' generic ERROR_CODES — a household-domain code
  // (apps/api/src/domains/household/errors/householdErrors.ts). Literal key;
  // the map is Record<string, string> precisely so domain codes can land here.
  ALREADY_MEMBER: 'errors:alreadyMember',
  // ExpenseValidationError metadata.reason — mileage needs a rate on the
  // arrangement (apps/api/src/domains/pay/errors/payErrors.ts).
  NO_PAY_ARRANGEMENT: 'errors:noPayArrangementMileage',
  // AuthorizationError metadata.reason — owner_only household gate
  // (apps/api/src/errors/AuthorizationError.ts).
  NOT_OWNER: 'errors:notHouseholdOwner',
  // redeemInvite metadata.reason (§8c, apps/api household domain) — a
  // parent-role invite refused because the redeemer already has a live
  // parent household; the mobile-side answer is HouseholdDecisionSheet, not
  // this toast, but the redeem itself still needs a localized message for
  // the sheet's inline error.
  PARENT_ALREADY_HAS_HOUSEHOLD: 'errors:parentAlreadyHasHousehold',
  // redeemInvite metadata.reason — "join & close" refused because a carer is
  // attached to the household being archived.
  HOUSEHOLD_HAS_CARER: 'errors:householdHasCarer',
};

interface ErrorLike {
  message?: string;
  name?: string;
  /** Better Auth's stable error code, e.g. `PASSWORD_TOO_SHORT`. */
  code?: string;
  isAxiosError?: boolean;
  response?: {
    status?: number;
    data?: { error?: { code?: string; metadata?: { reason?: string } } };
  };
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

/** Domain-specific refusal reason carried in the error envelope's metadata. */
function extractMetadataReason(error: ErrorLike): string | undefined {
  return error.response?.data?.error?.metadata?.reason;
}

/**
 * Returns a localized error message for a given error.
 *
 * Resolution order:
 * 1. If `contextKey` is provided, use it verbatim (a fully-qualified i18n key,
 *    e.g. `errors:saveProfileFailed`) — the caller owns app-specific copy.
 * 2. If the error carries a domain-specific `metadata.reason`, map it to an
 *    `errors:*` key (takes precedence over the generic envelope `code`).
 * 3. If the error carries an API error code, map it to an `errors:*` key.
 * 4. Detect offline / network / timeout by shape and message.
 * 5. Fall back to `errors:unknown`.
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

  const metadataReason = extractMetadataReason(err);
  if (metadataReason && ERROR_CODE_TO_I18N_KEY[metadataReason]) {
    return t(ERROR_CODE_TO_I18N_KEY[metadataReason] as string);
  }

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
 * Better Auth error codes → localized auth copy — never surface raw English
 * backend strings in a bilingual app (Daylight UX #19).
 */
const AUTH_ERROR_CODE_TO_I18N_KEY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth:errors.invalidCredentials',
  INVALID_PASSWORD: 'auth:errors.invalidCredentials',
  // Sign-up's most common rejection. Falling through to `unknown` here is what
  // made the form unusable: nothing on screen said the password was short.
  PASSWORD_TOO_SHORT: 'auth:errors.passwordTooShort',
  USER_ALREADY_EXISTS: 'auth:errors.emailTaken',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth:errors.emailTaken',
  EMAIL_NOT_VERIFIED: 'auth:errors.emailNotConfirmed',
  // The reset link's token is spent or expired.
  INVALID_TOKEN: 'auth:errors.resetLinkInvalid',
};

/** Map a Better Auth client error (`{ code, message, status }`) to localized auth copy. */
export function getLocalizedAuthErrorMessage(
  error: unknown,
  t: ErrorTFunction
): string {
  const err = asErrorLike(error);
  const key = err.code ? AUTH_ERROR_CODE_TO_I18N_KEY[err.code] : undefined;
  if (key) return t(key);
  if ((error as { status?: number } | null)?.status === 429) {
    return t('auth:errors.rateLimited');
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

/**
 * Extracts the real HTTP status code if the error carries a `.response.status`.
 * Used to distinguish a genuine 404/403 from a generic network failure (where .response is absent).
 */
export function httpStatusOf(error: unknown): number | undefined {
  const err = asErrorLike(error);
  return typeof err.response?.status === 'number'
    ? err.response.status
    : undefined;
}
