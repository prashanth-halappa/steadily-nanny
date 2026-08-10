/**
 * @module hooks/mutations/useRecordPayment
 *
 * Records that an approved week's wages actually moved (067). Parents only,
 * approved weeks only, `sum(payments) <= gross_minor` — all enforced
 * server-side; this hook's job is the cache and the copy.
 *
 * TWO invalidations, and both are load-bearing. The ledger (`payment.all`,
 * not just `payment.forTimesheet` — a prefix of it, so the week's own list
 * still refetches too) is the obvious one; widening it to the whole domain is
 * what keeps a household-scoped payments screen (`payment.forHousehold`)
 * from sitting stale after a payment recorded on the Hours tab.
 * `timesheet.all` is the one that is easy to forget: the paid badge and the
 * outstanding balance render on the WEEK view, which is served from the
 * timesheet cache, so invalidating only the ledger leaves a freshly-settled
 * week still reading "Unpaid" until something else happens to refetch it.
 *
 * The over-payment refusal gets its OWN copy rather than falling through to
 * `errors:validation`. "Please check the information you entered" is useless
 * against a ceiling the parent cannot see — the server hands back
 * `alreadyPaidMinor`/`grossMinor` precisely so the client can say which
 * figures it hit, and `overPaymentMetadata` below is what the sheet reads to
 * do that.
 */
import type {
  CreatePaymentInput,
  Payment,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { paymentApi } from '@/src/api/endpoints/payments';
import { queryKeys } from '@/src/api/queryKeys';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';
import { showErrorToast } from '@/src/lib/toast';

interface RecordPaymentVariables {
  timesheetId: string;
  input: CreatePaymentInput;
}

interface ErrorLike {
  response?: {
    status?: number;
    data?: {
      error?: {
        metadata?: {
          reason?: string;
          alreadyPaidMinor?: number;
          grossMinor?: number;
        };
      };
    };
  };
}

/** What the server said the week is worth and what it has already taken. */
export interface OverPaymentMetadata {
  alreadyPaidMinor: number;
  grossMinor: number;
}

/**
 * The `PAYMENT_EXCEEDS_GROSS` refusal's figures, or `null` for every other
 * failure. Exported because the sheet states them inline ("£200.00 of
 * £236.12 is already recorded") — re-deriving them from a stale local ledger
 * would print a different number than the one the server refused against.
 *
 * `reason` (not `code`) is where the specific label lives: `ValidationError`
 * stamps the generic `VALIDATION_ERROR` code and puts its label in
 * `metadata.reason` — see `apps/api/src/errors/BaseError.ts`.
 */
export function overPaymentMetadata(
  error: unknown
): OverPaymentMetadata | null {
  const err = (error ?? {}) as ErrorLike;
  const metadata = err.response?.data?.error?.metadata;
  if (
    err.response?.status !== 400 ||
    metadata?.reason !== 'PAYMENT_EXCEEDS_GROSS' ||
    typeof metadata.alreadyPaidMinor !== 'number' ||
    typeof metadata.grossMinor !== 'number'
  ) {
    return null;
  }
  return {
    alreadyPaidMinor: metadata.alreadyPaidMinor,
    grossMinor: metadata.grossMinor,
  };
}

function getRecordPaymentErrorKey(error: unknown): string | undefined {
  if (overPaymentMetadata(error)) return 'hours:paid.exceedsGrossError';
  const err = (error ?? {}) as ErrorLike;
  if (
    err.response?.status === 409 &&
    err.response.data?.error?.metadata?.reason === 'PAYMENT_WEEK_NOT_APPROVED'
  ) {
    return 'hours:paid.weekNotApprovedError';
  }
  return undefined;
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  const { t } = useTranslation('errors');

  return useMutation<Payment, Error, RecordPaymentVariables>({
    mutationFn: ({ timesheetId, input }) =>
      paymentApi.create(timesheetId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payment.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.timesheet.all });
    },
    onError: error => {
      showErrorToast(
        getLocalizedErrorMessage(error, t, getRecordPaymentErrorKey(error))
      );
    },
  });
}
