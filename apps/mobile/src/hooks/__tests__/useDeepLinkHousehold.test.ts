/**
 * @module hooks/__tests__/useDeepLinkHousehold.test
 *
 * Pattern A navigation-time (`docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §A).
 * A TAB can only show one household, so a deep link carrying `householdId`
 * has to MOVE the switcher — and exactly once per id, because the tabs never
 * unmount and the effect re-runs on every render of a screen that lives
 * forever.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { renderHook } from '@testing-library/react-native';

const HOUSEHOLD_A = {
  id: 'household-a',
  name: 'The Reyes Household',
  timezone: 'America/New_York',
} as Household;
const HOUSEHOLD_B = {
  id: 'household-b',
  name: 'The Chen Household',
  timezone: 'Europe/London',
} as Household;

const setActiveHouseholdId = mock((_id: string | null) => {});
const showInfoToast = mock((_message: string, _title?: string) => {});

let activeHouseholdId: string | null = HOUSEHOLD_A.id;
let knownHouseholds: Household[] = [HOUSEHOLD_A, HOUSEHOLD_B];

mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: knownHouseholds.find(h => h.id === activeHouseholdId) ?? null,
    householdId: activeHouseholdId,
    households: knownHouseholds,
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId,
    isLoading: false,
    isError: false,
  }),
}));

mock.module('@/src/lib/toast', () => ({ showInfoToast }));

let useDeepLinkHousehold: typeof import('../useDeepLinkHousehold').useDeepLinkHousehold;

beforeEach(async () => {
  ({ useDeepLinkHousehold } = await import('../useDeepLinkHousehold'));
  setActiveHouseholdId.mockClear();
  showInfoToast.mockClear();
  activeHouseholdId = HOUSEHOLD_A.id;
  knownHouseholds = [HOUSEHOLD_A, HOUSEHOLD_B];
});

describe('useDeepLinkHousehold', () => {
  it('switches to the linked household and says so, exactly once', () => {
    const { rerender, result } = renderHook(
      (param: string | string[] | undefined) => useDeepLinkHousehold(param),
      { initialProps: HOUSEHOLD_B.id as string | string[] | undefined }
    );

    expect(setActiveHouseholdId).toHaveBeenCalledTimes(1);
    expect(setActiveHouseholdId).toHaveBeenCalledWith(HOUSEHOLD_B.id);
    expect(showInfoToast).toHaveBeenCalledTimes(1);
    expect(showInfoToast).toHaveBeenCalledWith('deepLink.switched');
    expect(result.current.notMember).toBe(false);

    // The tab does not unmount: a re-render must not re-fire the switch.
    activeHouseholdId = HOUSEHOLD_B.id;
    rerender(HOUSEHOLD_B.id);
    rerender(HOUSEHOLD_B.id);

    expect(setActiveHouseholdId).toHaveBeenCalledTimes(1);
    expect(showInfoToast).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the link names the household already showing', () => {
    renderHook(() => useDeepLinkHousehold(HOUSEHOLD_A.id));

    expect(setActiveHouseholdId).not.toHaveBeenCalled();
    expect(showInfoToast).not.toHaveBeenCalled();
  });

  it('does nothing when there is no householdId on the link', () => {
    const { result } = renderHook(() => useDeepLinkHousehold(undefined));

    expect(setActiveHouseholdId).not.toHaveBeenCalled();
    expect(result.current.notMember).toBe(false);
  });

  it('reports notMember and switches nothing for a household she is not in', () => {
    const { result } = renderHook(() => useDeepLinkHousehold('household-z'));

    expect(result.current.notMember).toBe(true);
    expect(setActiveHouseholdId).not.toHaveBeenCalled();
    expect(showInfoToast).not.toHaveBeenCalled();
  });

  it('re-fires when a SECOND push names a different household', () => {
    const { rerender } = renderHook(
      (param: string | string[] | undefined) => useDeepLinkHousehold(param),
      { initialProps: HOUSEHOLD_B.id as string | string[] | undefined }
    );
    expect(setActiveHouseholdId).toHaveBeenCalledTimes(1);

    activeHouseholdId = HOUSEHOLD_B.id;
    rerender(HOUSEHOLD_A.id);

    expect(setActiveHouseholdId).toHaveBeenCalledTimes(2);
    expect(setActiveHouseholdId).toHaveBeenLastCalledWith(HOUSEHOLD_A.id);
    expect(showInfoToast).toHaveBeenCalledTimes(2);
  });

  it('normalises the array form expo-router can hand back', () => {
    renderHook(() => useDeepLinkHousehold([HOUSEHOLD_B.id, 'ignored']));

    expect(setActiveHouseholdId).toHaveBeenCalledWith(HOUSEHOLD_B.id);
  });

  it('treats a cleared param ("undefined"/"null") as absent', () => {
    const { result } = renderHook(() => useDeepLinkHousehold('undefined'));

    expect(setActiveHouseholdId).not.toHaveBeenCalled();
    expect(result.current.notMember).toBe(false);
  });
});
