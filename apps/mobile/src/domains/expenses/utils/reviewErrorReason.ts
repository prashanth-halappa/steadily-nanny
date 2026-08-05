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
