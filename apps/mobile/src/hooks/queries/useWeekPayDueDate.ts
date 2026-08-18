/** @module hooks/queries/useWeekPayDueDate — when the pay period one week belongs to falls due. */
import { computePayDueDate } from '@steadily-nanny/shared-types/payPeriod';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';

interface WeekPayDueDateArgs {
  householdId: string | null | undefined;
  carerId: string | null | undefined;
  /** The week's own first and last day, household-local `YYYY-MM-DD`. */
  weekStartISO: string;
  weekEndISO: string;
  /** `households.week_starts_on`, 0=Sunday..6=Saturday. */
  weekStartsOn: number;
}

/**
 * THREE-VALUED, deliberately, and every caller must forward all three:
 *
 * - a `YYYY-MM-DD` date — the period this week belongs to falls due then;
 * - `null` — the family has stated no pay schedule, so no due date exists;
 * - `undefined` — we do not KNOW yet (the arrangement read is in flight or
 *   failed). Collapsing this onto `null` would print "No pay day set" over a
 *   household that has one — docs/11-MONEY.md §4's unknown-is-not-zero rule
 *   applied to a date. `PaidStateSection` renders nothing for `undefined`.
 *
 * PRESENTATION ONLY. The date is derived from `pay_frequency` and the pay-day
 * fields the family already agreed; it is never a money fact, never part of a
 * total, and nothing may act on it. Both week views call this so a carer and
 * a parent cannot be shown two different answers to "when is this owed" —
 * the calendar rule itself lives once, in
 * `@steadily-nanny/shared-types/payPeriod`.
 */
export function useWeekPayDueDate({
  householdId,
  carerId,
  weekStartISO,
  weekEndISO,
  weekStartsOn,
}: WeekPayDueDateArgs): string | null | undefined {
  const arrangementQuery = useCurrentPayArrangement(householdId, carerId);

  // `isPending` also covers a DISABLED query (no session, no carer yet),
  // which is the honest answer there too: not known.
  if (arrangementQuery.isPending || arrangementQuery.isError) return undefined;

  const arrangement = arrangementQuery.data;
  return computePayDueDate({
    weekStart: weekStartISO,
    weekEnd: weekEndISO,
    weekStartsOn,
    payFrequency: arrangement?.pay_frequency ?? null,
    payDayOfWeek: arrangement?.pay_day_of_week ?? null,
    payDayOfMonth: arrangement?.pay_day_of_month ?? null,
    // Only read for `biweekly`, and a biweekly schedule cannot exist without
    // an arrangement to carry it — so the fallback is never the value used.
    arrangementValidFrom: arrangement?.valid_from ?? weekStartISO,
  });
}
