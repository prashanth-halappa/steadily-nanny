/**
 * @module hooks/mutations/useCorrectPayment
 *
 * Reverses a recorded payment by APPENDING a correcting row (D-20, migration
 * 085). Parents only, one level deep (a correction is never itself
 * correctable), and bounded by what is left of the payment it points at — all
 * enforced server-side; this hook's job is the cache and the copy.
 *
 * THE SAME TWO INVALIDATIONS `useRecordPayment` DOES, for the same two
 * reasons. The ledger (`payment.all`, a prefix, so the week's own list
 * refetches too) is the obvious one; `timesheet.all` is the one that is easy
 * to forget, because the paid badge and the balance render on the WEEK view,
 * which is served from the timesheet cache — and a correction MOVES both. A
 * correction that lowers paid-to-date without refreshing the week would leave
 * a nanny reading "Paid" over a week that is now short.
 *
 * Both refusals get their own copy rather than falling through to
 * `errors:validation`, and both ALSO render inline in the sheet
 * (GOLDEN-FIXES #40 — a toast over an open `BottomSheetBase` is invisible).
 * The toast stays for any caller with no sheet open.
 */
import type {
  CreatePaymentCorrectionInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { paymentApi } from '@/src/api/endpoints/payments';
import { queryKeys } from '@/src/api/queryKeys';
import type { PaymentCorrectionRefusal } from '@/src/domains/timesheet/components/PaymentCorrectionSheet';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface CorrectPaymentVariables {
  timesheetId: string;
  paymentId: string;
  input: CreatePaymentCorrectionInput;
}

interface ErrorLike {
  response?: {
    status?: number;
    data?: {
      error?: {
        metadata?: {
          reason?: string;
          originalAmountMinor?: number;
          remainingMinor?: number;
        };
      };
    };
  };
}

/**
 * The correction refusal the sheet renders inline, or `null` for every other
 * failure. Exported for the same reason `overPaymentMetadata` is: the sheet
 * states the server's OWN figures ("£342.00 left to reverse"), and
 * re-deriving them from a stale local ledger would print a different number
 * than the one the server refused against.
 *
 * `reason` (not `code`) is where the specific label lives on the 400:
 * `ValidationError` stamps the generic `VALIDATION_ERROR` code and puts its
 * label in `metadata.reason` (`apps/api/src/errors/BaseError.ts`).
 *
 * The 409 arm is matched on STATUS ALONE, deliberately. `ConflictError` puts
 * its own label in `metadata.reason` too, but `PaymentNotCorrectableError`
 * then overwrites it with the specific arm (`week_missing` /
 * `payment_missing` / `not_a_payment`), so `PAYMENT_NOT_CORRECTABLE` never
 * appears on the wire — and matching the arm list would silently fall through
 * to a generic toast the day a fourth arm is added. Every 409 this endpoint
 * can raise is this refusal; its gates 1 and 2 answer with 404 and 403.
 */
export function correctionRefusalMetadata(
  error: unknown
): PaymentCorrectionRefusal | null {
  const err = (error ?? {}) as ErrorLike;
  const status = err.response?.status;
  const metadata = err.response?.data?.error?.metadata;

  if (
    status === 400 &&
    metadata?.reason === 'PAYMENT_CORRECTION_EXCEEDS_ORIGINAL' &&
    typeof metadata.originalAmountMinor === 'number' &&
    typeof metadata.remainingMinor === 'number'
  ) {
    return {
      reason: 'exceeds_original',
      originalAmountMinor: metadata.originalAmountMinor,
      remainingMinor: metadata.remainingMinor,
    };
  }
  if (status === 409) return { reason: 'not_correctable' };
  return null;
}

function getCorrectPaymentErrorKey(error: unknown): string | undefined {
  const refusal = correctionRefusalMetadata(error);
  if (refusal?.reason === 'exceeds_original') {
    return 'hours:paid.correctionExceedsError';
  }
  if (refusal?.reason === 'not_correctable') {
    return 'hours:paid.notCorrectableError';
  }
  return undefined;
}

export function useCorrectPayment() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Payment, Error, CorrectPaymentVariables>({
    mutationFn: ({ timesheetId, paymentId, input }) =>
      paymentApi.correct(timesheetId, paymentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payment.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(
        getLocalizedErrorMessage(error, t, getCorrectPaymentErrorKey(error))
      );
    },
  });
}
