/**
 * @module domains/timeOff/hooks/usePaidFamilyCounts
 *
 * Cross-family paid-marker counts for the signed-in carer's OWN time-off
 * rows (TIER0-CX-SPEC.md §5.2's `/settings/time-off` surface).
 * `carer_time_off` deliberately carries NO household reference
 * (011_availability.sql) — that absence is what makes cross-family leakage
 * of a nanny's time off structurally impossible. So "how many families paid
 * this" can only be answered by asking each of the carer's OWN households
 * whether THEIR `pto_ledger` references this time-off id, then counting
 * HOUSEHOLDS, never naming one.
 *
 * `useHouseholds()` is read here ONLY for its `id` field. A household's
 * display label is fetched as part of the same object but is never read,
 * stored, or passed to any caller of this hook — the anonymity promise
 * depends on that discipline holding all the way down, which is why a
 * dedicated source-inspection test in this domain's `__tests__/` folder
 * asserts this file never dereferences that display-label field at all.
 *
 * PAID-NESS IS NETTED, NOT PRESENCE-BASED (Phase 3+4 adversarial review,
 * finding 2): counting a household as "paid this time off" from the mere
 * PRESENCE of a `usage` row keeps counting it forever, even after the
 * carer cancels the time off and the server writes a reversing
 * `adjustment` row (the ledger is append-only — see `netPaidMinutesForTimeOff`'s
 * doc). This hook nets each household's ledger per time-off id before
 * counting it, so a fully-reversed family drops out of the count and a
 * partially-reversed one still counts (she IS still paid, for the
 * remainder).
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useQueries } from '@tanstack/react-query';
import { ptoApi } from '@/src/api/endpoints/pto';
import { queryKeys } from '@/src/api/queryKeys';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { netPaidMinutesForTimeOff } from '../utils/ptoNet';

/** Ledger year in the household's zone — same rule as `HouseholdTimeOffRow`. */
function yearOfInZone(startsAtIso: string, timeZone: string): number {
  return Number(localDateInZone(timeZone, new Date(startsAtIso)).slice(0, 4));
}

export interface PaidFamilyCounts {
  /** A time-off id absent from this map means "no family has paid it" —
   * ONLY once `isLoading` is false AND `isError` is false. While loading,
   * or on a failed read, an absent id says nothing either way (the
   * underlying ledger fetches simply haven't resolved, or didn't
   * succeed); callers must check both before treating an absent id as a
   * resolved zero. */
  counts: Map<string, number>;
  /** True while any of the underlying per-household ledger fetches this
   * hook needs are still in flight. */
  isLoading: boolean;
  /** True when the household list OR any per-household ledger fetch
   * failed. A dropped connection must never render as "no family has
   * paid this" — the whole reason `counts` documents its own caveat
   * above. */
  isError: boolean;
}

/**
 * Bounded to the DISTINCT (household, year) pairs actually needed for
 * `timeOffRows`, so a carer with two families and one year of history
 * issues at most two ledger fetches, not one per row.
 */
export function usePaidFamilyCounts(
  timeOffRows: CarerTimeOff[]
): PaidFamilyCounts {
  const carerId = useAuthStore(s => s.user?.id ?? null);
  const households = useHouseholds();
  const householdList = households.data ?? [];

  // Each household's ledger is keyed by calendar year in THAT household's
  // zone (HouseholdTimeOffRow uses the same rule) — not UTC, which mis-buckets
  // time off that straddles New Year when device tz ≠ household tz.
  const pairKeySet = new Set<string>();
  const pairs: { householdId: string; year: number; timeZone: string }[] = [];
  for (const household of householdList) {
    for (const row of timeOffRows) {
      const year = yearOfInZone(row.starts_at, household.timezone);
      const key = `${household.id}:${year}`;
      if (pairKeySet.has(key)) continue;
      pairKeySet.add(key);
      pairs.push({
        householdId: household.id,
        year,
        timeZone: household.timezone,
      });
    }
  }

  const ledgerQueries = useQueries({
    queries: pairs.map(({ householdId, year }) => ({
      queryKey: queryKeys.pto.ledger(householdId, carerId ?? undefined, year),
      queryFn: () => ptoApi.getLedger(householdId, carerId as string, year),
      enabled: !!carerId && householdList.length > 0,
      staleTime: 60_000,
    })),
  });

  const counts = new Map<string, number>();
  ledgerQueries.forEach((query, index) => {
    const pair = pairs[index];
    if (!pair || !query.data) return;
    // Bounded to the time-off rows that actually fall in this query's year
    // — netting is per (household, year) ledger, and a reversing
    // adjustment always shares its usage row's `effective_date` (so its
    // year), never a different one.
    const timeOffIdsThisYear = timeOffRows
      .filter(row => yearOfInZone(row.starts_at, pair.timeZone) === pair.year)
      .map(row => row.id);
    for (const timeOffId of timeOffIdsThisYear) {
      const netMinutes = netPaidMinutesForTimeOff(query.data, timeOffId);
      if (netMinutes > 0) {
        counts.set(timeOffId, (counts.get(timeOffId) ?? 0) + 1);
      }
    }
  });

  const isLoading =
    households.isPending ||
    (pairs.length > 0 && ledgerQueries.some(query => query.isPending));
  const isError =
    households.isError || ledgerQueries.some(query => query.isError);

  return { counts, isLoading, isError };
}
