/**
 * @module domains/expenses/utils/reviewErrorReason
 *
 * Extracts `error.response.data.error.metadata.reason` off an
 * axios-shaped error, for the ONE domain-specific arm the review sheet
 * needs to branch on: `ExpenseValidationError`'s `NO_MILEAGE_RATE` reason
 * (`apps/api/src/domains/pay/errors/payErrors.ts`) — approving a mileage
 * claim when the household has no mileage rate set gets refused rather
 * than approved at £0.00 (docs/11-MONEY.md §4).
 *
 * Deliberately separate from `lib/errorLocalization.ts`, which maps the
 * generic `error.code` (e.g. `VALIDATION_ERROR`) to a translation key and
 * has no notion of a domain-specific `metadata.reason` — this is a small,
 * additive read alongside that generic toast, not a replacement for it
 * (`useReviewExpense`'s `onError` still fires the generic toast; the
 * review sheet ALSO inspects the raw error for this specific arm).
 */
export function reviewErrorReason(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const withResponse = error as {
    response?: { data?: { error?: { metadata?: { reason?: unknown } } } };
  };
  const reason = withResponse.response?.data?.error?.metadata?.reason;
  return typeof reason === 'string' ? reason : null;
}

/**
 * True when `error` is a deliberate, server-CODED refusal (a real 4xx with
 * an `error.code` in the envelope) as opposed to a network/timeout/unknown
 * failure `getLocalizedErrorMessage`'s generic toast already covers.
 *
 * Phase 3+4 adversarial review, finding 6: reviewing an expense into a week
 * that's already `approved` is one such deliberate refusal the API is
 * still deciding how to shape (block with a typed error vs. silently
 * reopen the week — see the review flow's own TODO for the exact code).
 * Until that code is known, this is the general "was this actually a typed
 * refusal, not just noise" test any UNRECOGNISED typed reason can be
 * routed through, so the caller can show something more specific than the
 * bare generic toast without having to guess which reason it was.
 */
export function isTypedReviewError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const withResponse = error as {
    response?: { status?: unknown; data?: { error?: { code?: unknown } } };
  };
  const status = withResponse.response?.status;
  const code = withResponse.response?.data?.error?.code;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof code === 'string'
  );
}
