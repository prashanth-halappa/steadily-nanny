/**
 * @module domains/pay/utils/termRows
 *
 * The six `AmountRow`s every "Pay & terms" card shows, in the fixed order
 * TIER0-CX-SPEC.md §2 specifies, built from one `PayArrangement`. Shared
 * between the parent's current-terms card (`PayArrangementScreen`) and the
 * nanny's read-only card (`MyPayScreen`) so the two surfaces can never drift
 * on wording or order.
 *
 * The PTO balance row (6th) is a signpost, not a computed value, in Phase 1:
 * `pto_ledger` (TIER0-PLAN.md Phase 3) doesn't exist yet, so there is no
 * balance to read. Rendering a fabricated number here — even one derived
 * "honestly" from the entitlement alone — would violate the app's own
 * no-arrangement-no-zero discipline generalised: never show a figure you
 * cannot back with data. It renders `notSet` unconditionally until Phase 3
 * wires a real balance hook in.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { formatMoney } from '@/src/lib/money';

/** Narrow translate fn — avoids fighting i18next's overloaded TFunction
 * generics (same pattern as `lib/clashWarningToast.ts`'s `Translate`). */
type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface TermRow {
  key: string;
  label: string;
  /** `null` renders `valueWhenNull` (defaults to "Not set" — the caller's
   * `AmountRow` applies that default). */
  value: string | null;
  /** Only the cancellations row overrides this — "No cancellation pay" is an
   * explicit agreement, never a gap (TIER0-CX-SPEC.md §2). */
  valueWhenNull?: string;
}

function formatMultiplier(multiplier: number): string {
  // Trims a trailing ".0" — 1.5 stays "1.5", 2 becomes "2", not "2.0".
  return Number(multiplier.toFixed(2)).toString();
}

export function buildTermRows(
  arrangement: PayArrangement,
  t: Translate
): TermRow[] {
  return [
    {
      key: 'overtime',
      label: t('terms.overtimeLabel'),
      value:
        arrangement.overtime_threshold_minutes === null
          ? null
          : t('terms.overtimeValue', {
              hours: arrangement.overtime_threshold_minutes / 60,
              multiplier: formatMultiplier(arrangement.overtime_multiplier),
            }),
    },
    {
      key: 'guaranteedHours',
      label: t('terms.guaranteedHoursLabel'),
      value:
        arrangement.guaranteed_minutes_per_week === null
          ? null
          : t('terms.guaranteedHoursValue', {
              hours: arrangement.guaranteed_minutes_per_week / 60,
            }),
    },
    {
      key: 'pto',
      label: t('terms.ptoLabel'),
      value:
        arrangement.pto_entitlement_minutes_per_year === null
          ? null
          : t('terms.ptoValue', {
              hours: arrangement.pto_entitlement_minutes_per_year / 60,
            }),
    },
    {
      key: 'cancellations',
      label: t('terms.cancellationsLabel'),
      value:
        arrangement.cancellation_paid_within_hours === null
          ? null
          : t('terms.cancellationsValue', {
              hours: arrangement.cancellation_paid_within_hours,
            }),
      valueWhenNull: t('noCancellationPay'),
    },
    {
      key: 'mileage',
      label: t('terms.mileageLabel'),
      value:
        arrangement.mileage_rate_per_mile_minor === null
          ? null
          : t('terms.mileageValue', {
              amount: formatMoney(
                arrangement.mileage_rate_per_mile_minor,
                arrangement.currency
              ),
            }),
    },
    {
      // Phase 3 (pto_ledger) replaces this with a real balance — see the
      // module comment. Always "Not set" until then, deliberately.
      key: 'ptoBalance',
      label: t('terms.ptoBalanceLabel'),
      value: null,
    },
  ];
}
