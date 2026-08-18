/**
 * @module domains/schedule/utils/carerDayBreakdown
 *
 * S7: `ScheduleShiftsScreen`'s parent-lead line named the FIRST carer
 * (`carersQuery.data?.[0]`) while counting shifts from EVERY carer in the
 * household — "{{name}} is with the children N days this week" was a wrong
 * factual claim the moment a second nanny worked days of her own. This
 * counts covering days PER carer instead of summing across them (the S7d
 * design rule: "totals are per carer, never summed across carers").
 */

/** Per-carer count of DISTINCT local dates she has a covering shift on. */
export interface CarerDayCount {
  carerId: string;
  name: string;
  days: number;
}

export function carerDayBreakdown(
  carers: readonly { userId: string; name: string }[],
  coveringShifts: readonly { carer_id: string | null; local_date: string }[]
): CarerDayCount[] {
  return carers.map(carer => ({
    carerId: carer.userId,
    name: carer.name,
    days: new Set(
      coveringShifts
        .filter(shift => shift.carer_id === carer.userId)
        .map(shift => shift.local_date)
    ).size,
  }));
}
