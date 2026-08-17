/**
 * @module hooks/useDeepLinkHousehold
 *
 * Pattern A NAVIGATION-TIME (`docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §A) —
 * the TAB half of the hybrid rule.
 *
 * A DETAIL screen renders one entity and resolves that entity's household
 * from its own `household_id` (`useHouseholdById`); it must never move the
 * switcher, because the reader is looking at one shift/proposal, not at a
 * family. A TAB (Hours, Schedule) can only ever show ONE household, so a
 * push that lands there carrying `householdId` has no honest option but to
 * MOVE the switcher — otherwise the notification about family B opens
 * family A's week and says nothing about it.
 *
 * Moving it silently would be its own lie, so the switch is announced with
 * a one-line info toast naming the family now on screen.
 *
 * ONCE PER ID. The tabs never unmount, so this effect re-runs on every
 * render of a screen that lives for the whole session; keying it on `[]`
 * would miss the second push and keying it on nothing would fire the toast
 * on every render. The dep is the normalised id.
 *
 * A target the reader is not a member of gets NO switch and `notMember:
 * true` — the caller renders the not-a-member ErrorState. Distinct from
 * "still loading", which is neither.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdById } from '@/src/hooks/queries/useHouseholdById';
import { showInfoToast } from '@/src/lib/toast';

export interface UseDeepLinkHouseholdResult {
  /** Settled, an id was on the link, and it names no household of hers. */
  notMember: boolean;
}

/**
 * Expo Router hands a search param back as a string, an array (repeated
 * key), or — once cleared via `setParams` — `null`/the literal `"undefined"`.
 * Same normalisation `HoursScreen` already applies to `weekStart`.
 */
function normalizeParam(
  value: string | string[] | undefined | null
): string | undefined {
  if (value == null || value === 'undefined' || value === 'null') {
    return undefined;
  }
  const first = Array.isArray(value) ? value[0] : value;
  return first == null || first === '' ? undefined : first;
}

export function useDeepLinkHousehold(
  param: string | string[] | undefined
): UseDeepLinkHouseholdResult {
  const { t } = useTranslation('common');
  const targetId = normalizeParam(param);
  const { household: target, notMember } = useHouseholdById(targetId);
  const { householdId: activeId, setActiveHouseholdId } = useActiveHousehold();

  // The id this hook has already acted on. A ref, not state: the switch is a
  // side effect on a store, and re-rendering to record that it happened
  // would be a second render for no visible change.
  const switchedFor = useRef<string | null>(null);
  const targetName = target?.name ?? null;

  useEffect(() => {
    if (!targetId || !target) return;
    if (switchedFor.current === targetId) return;
    if (targetId === activeId) return;
    switchedFor.current = targetId;
    setActiveHouseholdId(targetId);
    showInfoToast(t('deepLink.switched', { name: targetName ?? '' }));
    // `activeId` IS a dep, and harmless: it changes as a result of the call
    // above, and the re-run it causes is caught by the `switchedFor` guard
    // one line into the effect.
  }, [targetId, target, activeId, setActiveHouseholdId, t, targetName]);

  return { notMember };
}
