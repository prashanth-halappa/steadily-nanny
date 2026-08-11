/**
 * @module domains/pay/utils/termRows
 *
 * The ten `AmountRow`s every "Pay & terms" card shows, in the fixed order
 * TIER0-CX-SPEC.md §2 specifies, built from one `PayArrangement`. Shared
 * between the parent's current-terms card (`PayArrangementScreen`) and the
 * nanny's read-only card (`MyPayScreen`) so the two surfaces can never drift
 * on wording or order.
 *
 * The PTO balance row (last) is the real `pto_ledger` balance (TIER0-PLAN.md
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

/**
 * "How often you pay" (082, D-17, T7 reversal) — presentation only, one term
 * describing itself, no cross-referenced day yet. The day (weekday or
 * day-of-month) is a `PayChangeSheet`/`PaySetupScreen` FORM detail, not part
 * of this read-only summary row — the frequency alone is what a parent or
 * nanny scans this card for.
 */
function payScheduleValue(
  frequency: PayArrangement['pay_frequency'],
  t: Translate
): string | null {
  switch (frequency) {
    case 'weekly':
      return t('terms.payScheduleValueWeekly');
    case 'biweekly':
      return t('terms.payScheduleValueBiweekly');
    case 'semimonthly':
      return t('terms.payScheduleValueSemimonthly');
    case 'monthly':
      return t('terms.payScheduleValueMonthly');
    default:
      return null;
  }
}

/**
 * "Outside wages" (D-13) and "In writing" (T9) live in the arrangement's
 * `terms` jsonb rather than in columns, and until 3-O they had no read-only
 * row at all — they were enterable and invisible. That is survivable on a
 * card the parent who typed them is reading; it is not survivable on the
 * proposal review screen, where a term that does not render is a term he
 * agrees to without being shown it, and where the nanny then becomes the
 * person who "snuck something in" (`screens-onboarding-terms-proposal.md`
 * §7.2, M22). One inventory, so all three surfaces gained them together.
 *
 * Every read below narrows rather than coerces — the bag is
 * `Record<string, unknown>` on the wire, and a hand-edited row of the wrong
 * shape is DROPPED, never rendered as a term somebody agreed to.
 */
const IN_WRITING_FIELD_COUNT = 5;

function stipendLine(
  row: unknown,
  currency: string,
  t: Translate
): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const { label, amount_minor, cadence } = row as Record<string, unknown>;
  if (typeof label !== 'string' || typeof amount_minor !== 'number') {
    return null;
  }
  const params = { label, amount: formatMoney(amount_minor, currency) };
  // Literal keys, never a computed `outsideWagesItem${cadence}` — a computed
  // key is invisible to the locale-key resolution guard, and a key no test
  // can see is a key that silently stops resolving in Spanish.
  switch (cadence) {
    case 'monthly':
      return t('terms.outsideWagesItemMonthly', params);
    case 'annual':
      return t('terms.outsideWagesItemAnnual', params);
    default:
      return t('terms.outsideWagesItemWeekly', params);
  }
}

function outsideWagesValue(
  terms: Record<string, unknown> | undefined,
  currency: string,
  t: Translate
): string | null {
  const recurring = terms?.recurring;
  if (!Array.isArray(recurring)) return null;
  const lines = recurring
    .map(row => stipendLine(row, currency, t))
    .filter((line): line is string => line !== null);
  return lines.length === 0 ? null : lines.join(' · ');
}

function inWritingLines(
  terms: Record<string, unknown> | undefined,
  t: Translate
): string[] {
  const lines: string[] = [];
  const notice = terms?.notice_period_days;
  if (typeof notice === 'number') {
    lines.push(t('terms.inWritingNotice', { weeks: notice / 7 }));
  }
  const probation = terms?.probation_days;
  if (typeof probation === 'number') {
    lines.push(t('terms.inWritingProbation', { days: probation }));
  }
  const freeText = [
    ['duties', 'terms.inWritingDuties'],
    ['driving', 'terms.inWritingDriving'],
    ['live_in', 'terms.inWritingLiveIn'],
  ] as const;
  for (const [field, key] of freeText) {
    const text = terms?.[field];
    if (typeof text === 'string' && text.trim() !== '') {
      lines.push(t(key, { text }));
    }
  }
  return lines;
}

export function buildTermRows(
  arrangement: PayArrangement,
  t: Translate,
  balance?: PtoBalance | null
): TermRow[] {
  const documentaryLines = inWritingLines(arrangement.terms, t);
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
    // 078's three tiers, between weekly overtime and the guarantee — the
    // order the terms document reads in (`screens-pay-terms.md` §3). Each is
    // null when its tier is off, which the caller renders as "Not set": an
    // explicit agreement, never a nag, and never a fabricated multiplier.
    {
      key: 'dailyOvertime',
      label: t('terms.dailyOvertimeLabel'),
      value:
        arrangement.overtime_daily_threshold_minutes == null
          ? null
          : t('terms.dailyOvertimeValue', {
              hours: arrangement.overtime_daily_threshold_minutes / 60,
              // Reuses the WEEKLY multiplier by design — the daily tier has
              // no multiplier column of its own (§3).
              multiplier: formatMultiplier(arrangement.overtime_multiplier),
            }),
    },
    {
      key: 'doubletime',
      label: t('terms.doubletimeLabel'),
      value:
        arrangement.doubletime_daily_threshold_minutes == null ||
        arrangement.doubletime_multiplier == null
          ? null
          : t('terms.doubletimeValue', {
              hours: arrangement.doubletime_daily_threshold_minutes / 60,
              multiplier: formatMultiplier(arrangement.doubletime_multiplier),
            }),
    },
    {
      key: 'seventhDay',
      label: t('terms.seventhDayLabel'),
      value:
        arrangement.seventh_day_multiplier == null
          ? null
          : arrangement.seventh_day_doubletime_after_minutes == null ||
              arrangement.doubletime_multiplier == null
            ? // Single-tier: one rate for the whole day.
              t('terms.seventhDayValue', {
                multiplier: formatMultiplier(
                  arrangement.seventh_day_multiplier
                ),
              })
            : t('terms.seventhDayTwoTierValue', {
                multiplier: formatMultiplier(
                  arrangement.seventh_day_multiplier
                ),
                doubleMultiplier: formatMultiplier(
                  arrangement.doubletime_multiplier
                ),
                hours: arrangement.seventh_day_doubletime_after_minutes / 60,
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
    // 3-E4, and the PRE-3-U1 inventory only: the holidays group is two
    // halves, and this is the arrangement's one — the premium, a term of HER
    // employment. The other half (which federal holidays the household
    // observes, as a per-family toggle list) is household-level and belongs
    // to 3-U1's terms-group UI, not to this fixed-order row list.
    {
      key: 'workedHolidayPremium',
      label: t('terms.workedHolidayPremiumLabel'),
      value:
        arrangement.worked_holiday_multiplier == null
          ? null
          : t('terms.workedHolidayPremiumValue', {
              multiplier: formatMultiplier(
                arrangement.worked_holiday_multiplier
              ),
            }),
    },
    // 3-E5 (§5 D-53), the holidays group's other half: what an observed
    // holiday NOBODY WORKED credits. Null is a real agreement here too ("a
    // holiday nobody works is unpaid"), so it renders as the group's blank
    // rather than an invented figure.
    {
      key: 'paidHolidayHours',
      label: t('terms.paidHolidayHoursLabel'),
      value:
        arrangement.holiday_hours_minutes == null
          ? null
          : t('terms.paidHolidayHoursValue', {
              hours: arrangement.holiday_hours_minutes / 60,
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
      key: 'paySchedule',
      label: t('terms.payScheduleLabel'),
      value: payScheduleValue(arrangement.pay_frequency ?? null, t),
    },
    {
      key: 'outsideWages',
      label: t('terms.outsideWagesLabel'),
      value: outsideWagesValue(arrangement.terms, arrangement.currency, t),
    },
    {
      key: 'inWriting',
      label: t('terms.inWritingLabel'),
      value:
        documentaryLines.length === 0
          ? null
          : t('inWriting.summary', {
              filled: documentaryLines.length,
              total: IN_WRITING_FIELD_COUNT,
            }),
      // The count alone would still leave the parent agreeing to a duties
      // paragraph he never read (§7.2). The spec's chevron is the one thing
      // given up here: the detail is always expanded rather than collapsible,
      // which costs vertical space and no information.
      subLine:
        documentaryLines.length === 0 ? undefined : documentaryLines.join('\n'),
    },
    ptoBalanceRow,
  ];
}
