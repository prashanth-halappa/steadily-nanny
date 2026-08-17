/**
 * @module hooks/queries/useHouseholdById
 *
 * The Pattern A fix's shared resolver (`docs/CROSS-CUTTING-DEFECT-PATTERNS.md`
 * §A). A component that renders an entity carrying its own `household_id`
 * (a shift, a proposal, an inbox row) must resolve that household's name,
 * timezone and currency from ITS OWN id — never from `useActiveHousehold`,
 * which answers a different question ("which household is the switcher on
 * right now") that happens to be right only for a single-household user.
 *
 * Resolves over the SAME source `useActiveHousehold` already reconciles —
 * `households` then `pastHouseholds` — so a shift in a household she was
 * since removed from (still payable, per `useActiveHousehold`'s module doc)
 * still resolves a name instead of falling through to a raw id.
 *
 * `CrossFamilyRhythmView.tsx` and `CrossFamilyStrip.tsx` hand-rolled this
 * exact lookup before this hook existed — both migrated to it here rather
 * than kept as a second, silently-drifting copy.
 */
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useMemo } from 'react';
import { useActiveHousehold } from './useActiveHousehold';

export interface UseHouseholdByIdResult {
  /** The resolved household, or `null` while loading / not found / no id given. */
  household: Household | null;
  isLoading: boolean;
  isError: boolean;
  /** True once loading has settled, an id was given, and it named no
   * household in either list — the honest "she isn't a member of this one"
   * signal, distinct from "still finding out". */
  notMember: boolean;
}

export interface UseHouseholdLookupResult {
  byId: Map<string, Household>;
  /** Falls back to the ACTIVE household's timezone, then `'UTC'` — the exact
   * fallback `CrossFamilyRhythmView.tsx` used before this hook existed. */
  timeZoneFor: (householdId: string | null | undefined) => string;
  nameFor: (householdId: string | null | undefined) => string | null;
  currencyFor: (householdId: string | null | undefined) => string | undefined;
}

function findHousehold(
  households: readonly Household[],
  pastHouseholds: readonly Household[],
  householdId: string
): Household | null {
  return (
    households.find(h => h.id === householdId) ??
    pastHouseholds.find(h => h.id === householdId) ??
    null
  );
}

export function useHouseholdById(
  householdId: string | null | undefined
): UseHouseholdByIdResult {
  const { households, pastHouseholds, isLoading, isError } =
    useActiveHousehold();

  const household = useMemo(
    () =>
      householdId
        ? findHousehold(households, pastHouseholds, householdId)
        : null,
    [households, pastHouseholds, householdId]
  );

  const notMember = !isLoading && !isError && !!householdId && !household;

  return { household, isLoading, isError, notMember };
}

export function useHouseholdLookup(): UseHouseholdLookupResult {
  const {
    household: activeHousehold,
    households,
    pastHouseholds,
  } = useActiveHousehold();

  const byId = useMemo(() => {
    const map = new Map<string, Household>();
    // Active households take precedence on a stale/duplicate id — same
    // resolution order `useActiveHousehold.household` already uses.
    for (const h of pastHouseholds) map.set(h.id, h);
    for (const h of households) map.set(h.id, h);
    return map;
  }, [households, pastHouseholds]);

  const activeTimeZone = activeHousehold?.timezone ?? 'UTC';

  const timeZoneFor = useMemo(
    () => (householdId: string | null | undefined) =>
      (householdId ? byId.get(householdId)?.timezone : undefined) ??
      activeTimeZone,
    [byId, activeTimeZone]
  );

  const nameFor = useMemo(
    () => (householdId: string | null | undefined) =>
      (householdId ? byId.get(householdId)?.name : undefined) ?? null,
    [byId]
  );

  const currencyFor = useMemo(
    () => (householdId: string | null | undefined) =>
      householdId ? byId.get(householdId)?.currency : undefined,
    [byId]
  );

  return { byId, timeZoneFor, nameFor, currencyFor };
}
