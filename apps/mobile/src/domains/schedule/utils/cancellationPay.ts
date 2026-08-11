/**
 * @module domains/schedule/utils/cancellationPay
 *
 * What a parent is told about pay BEFORE they send a cancellation request
 * (`docs/design/attention-and-notifications.md` §6, S3 / D-48). Pure so the
 * dialog and the short-notice hint can read the SAME answer and can never
 * print two contradictory sentences on one screen (§6.1).
 *
 * It mirrors the server's `resolveCancellationPaid`
 * (`apps/api/src/domains/shift/services/shiftChangeRequestCommandService.ts`)
 * arm for arm. Both sides now agree that no arrangement means no cancellation
 * pay (D-48): the server's old fallback to
 * `households.cancellation_paid_within_hours` was removed in 3-T3, so the
 * "ONE deliberate difference" this comment used to describe no longer exists.
 * Without an arrangement the week cannot be priced at all, and "there are no
 * pay terms set, so we can't say" is the honest thing to show.
 *
 * The arrangement's window is the ONLY cancellation window in the product
 * (§6.1 / D21). `households.cancellation_paid_within_hours` is deprecated and
 * is never read here, and `shift.is_short_notice` — computed server-side from
 * the unrelated `households.short_notice_hours` — is a TIMING fact, never a
 * pay claim, so it does not gate anything in this module either.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { formatEarningsDuration } from '@/src/domains/timesheet/utils/earningsFormat';
import { formatMoney } from '@/src/lib/money';

export type CancellationPayVariant =
  /** The arrangement query has not resolved — assert nothing about pay. */
  | 'pending'
  /** No arrangement at all: unpriceable, and we say exactly that. */
  | 'unknown'
  /** An arrangement with an explicit `null` window: no cancellation pay. */
  | 'noCancellationTerms'
  /** An arrangement whose window this cancellation falls outside. */
  | 'unpaid'
  /** Inside the window — still paid. */
  | 'paid';

export interface CancellationPayOutcome {
  variant: CancellationPayVariant;
  /** The arrangement's window in hours; null when there isn't one to name. */
  hours: number | null;
  /** "5h 00m" — set only alongside `amount`, since the copy names both or neither. */
  duration: string | null;
  /**
   * The formatted hourly rate, or null when the shift is paid but cannot be
   * priced. Null makes the caller drop the money clause entirely rather than
   * invent a figure (docs/11-MONEY.md) — and a zero rate resolves to null
   * here precisely so "$0.00" can never reach the dialog.
   */
  amount: string | null;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Hours from now until `startsAt` — negative once the shift has started. The
 * client-side twin of the server's own `hoursUntilStart`, and the ONE way any
 * caller here asks "how close is this shift".
 */
export function hoursUntilStart(
  startsAt: string,
  nowMs: number = Date.now()
): number {
  return (Date.parse(startsAt) - nowMs) / MS_PER_HOUR;
}

export function resolveCancellationPayOutcome(
  shift: Pick<Shift, 'starts_at' | 'ends_at'>,
  /** `undefined` = still loading; `null` = resolved, no arrangement. */
  arrangement: PayArrangement | null | undefined,
  nowMs: number = Date.now()
): CancellationPayOutcome {
  const none = { hours: null, duration: null, amount: null };

  if (arrangement === undefined) return { variant: 'pending', ...none };
  if (arrangement === null) return { variant: 'unknown', ...none };

  const window = arrangement.cancellation_paid_within_hours;
  if (window === null) return { variant: 'noCancellationTerms', ...none };

  if (hoursUntilStart(shift.starts_at, nowMs) >= window) {
    return { variant: 'unpaid', hours: window, duration: null, amount: null };
  }

  // A rate of zero is a rate we cannot show: `formatMoney` would render
  // "$0.00", which §6 forbids outright.
  const priceable = arrangement.rate_minor > 0;
  const minutes =
    (Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 60_000;

  return {
    variant: 'paid',
    hours: window,
    duration: priceable ? formatEarningsDuration(minutes) : null,
    amount: priceable
      ? formatMoney(arrangement.rate_minor, arrangement.currency)
      : null,
  };
}
