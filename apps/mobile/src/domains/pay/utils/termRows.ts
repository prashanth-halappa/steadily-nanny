/**
 * @module domains/pay/utils/termRows
 *
 * The six `AmountRow`s every "Pay & terms" card shows, in the fixed order
 * TIER0-CX-SPEC.md §2 specifies, built from one `PayArrangement`. Shared
 * between the parent's current-terms card (`PayArrangementScreen`) and the
 * nanny's read-only card (`MyPayScreen`) so the two surfaces can never drift
 * on wording or order.
 *
 * The PTO balance row (6th) is the real `pto_ledger` balance (TIER0-PLAN.md
 * Phase 3), passed in as `balance` — the THIRD, distinctly three-valued,
 * argument this function takes on purpose, so it maps directly onto
 * `usePtoBalance(...).data`'s own three states without the caller having to
 * juggle a separate `isPending` flag:
 *   - `undefined` — the balance query hasn't resolved yet. Renders a BLANK
 *     value (`''`), never "Not set" and never a fabricated "0h" — TIER0-CX-SPEC.md
 *     §5.2's "balance omitted while loading".
 *   - `null` — resolved, and there is nothing to show: no
 *     `pto_entitlement_minutes_per_year` on the arrangement (checked first,
 *     independent of what `balance` itself says — an arrangement with no
 *     entitlement is authoritative), or the API confirms no record exists.
 *     Renders "Not set" (the caller's `AmountRow` applies that default) — an
 *     explicit agreement, never a nag, same discipline as every other null
 *     term on this card.
 *   - a `PtoBalance` — renders the signed hours-left figure plus the
 *     "1 Jan – 31 Dec {{year}}" caption on the row's `subLine`. The balance
 *     may be NEGATIVE (a household can mark more paid than accrued — warn,
 *     never block, docs/11-MONEY.md §5) and is rendered exactly as reported,
 *     via `formatSignedHours`, never clamped to zero.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { PtoBalance } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { formatMoney } from '@/src/lib/money';
import { formatSignedHours } from './ptoFormat';

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
  /** Second line — the derivation. Only the PTO balance row uses this, for
   * the "1 Jan – 31 Dec {{year}}" caption (TIER0-CX-SPEC.md §2). */
  subLine?: string;
}

function formatMultiplier(multiplier: number): string {
  // Trims a trailing ".0" — 1.5 stays "1.5", 2 becomes "2", not "2.0".
  return Number(multiplier.toFixed(2)).toString();
}

export function buildTermRows(
  arrangement: PayArrangement,
  t: Translate,
  balance?: PtoBalance | null
): TermRow[] {
  const hasEntitlement = arrangement.pto_entitlement_minutes_per_year !== null;
  const ptoBalanceRow: TermRow = !hasEntitlement
    ? { key: 'ptoBalance', label: t('terms.ptoBalanceLabel'), value: null }
    : balance === undefined
      ? { key: 'ptoBalance', label: t('terms.ptoBalanceLabel'), value: '' }
      : balance === null
        ? { key: 'ptoBalance', label: t('terms.ptoBalanceLabel'), value: null }
        : {
            key: 'ptoBalance',
            label: t('terms.ptoBalanceLabel'),
            value: t('terms.ptoBalanceValue', {
              amount: formatSignedHours(balance.balance_minutes),
            }),
            subLine: t('terms.ptoBalanceCaption', { year: balance.year }),
          };

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
    ptoBalanceRow,
  ];
}
