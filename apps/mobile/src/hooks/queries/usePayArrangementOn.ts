/** @module hooks/queries/usePayArrangementOn — the rate + terms effective on ONE household-local date. */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { usePayArrangementHistory } from '@/src/hooks/queries/usePayArrangementHistory';

/**
 * The client twin of the server's `payArrangementRepo.effectiveOn`: the first
 * row of the server's newest-first history (`valid_from` desc, `created_at`
 * desc) with `valid_from <= date` and `valid_to` null or INCLUSIVE `>= date`.
 * `date` is a household-local `YYYY-MM-DD`; text compare is a date compare.
 */
export function arrangementEffectiveOn(
  history: readonly PayArrangement[],
  date: string
): PayArrangement | null {
  return (
    history.find(
      a => a.valid_from <= date && (a.valid_to === null || a.valid_to >= date)
    ) ?? null
  );
}

/**
 * The arrangement in force on `localDate` for one (household, carer) pair —
 * use this, not `useCurrentPayArrangement` (TODAY), for anything that answers
 * a question about a specific shift's day. `data` is `undefined` while the
 * history or the date is unknown, `null` when no arrangement covers the date.
 */
export function usePayArrangementOn(
  householdId: string | null | undefined,
  carerId: string | null | undefined,
  localDate: string | undefined
): { data: PayArrangement | null | undefined } {
  const history = usePayArrangementHistory(householdId, carerId);
  return {
    data:
      history.data === undefined || localDate === undefined
        ? undefined
        : arrangementEffectiveOn(history.data, localDate),
  };
}
