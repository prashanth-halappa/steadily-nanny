import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  HOUSEHOLD_MEMBER_STATUSES,
  type HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { renderHook } from '@testing-library/react-native';

const useMyMembershipsMock = mock(() => ({
  data: undefined as HouseholdMember[] | undefined,
  isLoading: true,
}));

const useAuthStoreMock = mock(
  (selector: (state: { user: { id: string } | null }) => unknown) => {
    return selector({ user: { id: 'user-1' } });
  }
);

beforeAll(() => {
  mock.module('@/src/hooks/queries/useMyMemberships', () => ({
    useMyMemberships: useMyMembershipsMock,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: useAuthStoreMock,
  }));
});

let useHasActiveMembership: typeof import('../useHasActiveMembership').useHasActiveMembership;

beforeEach(async () => {
  ({ useHasActiveMembership } = await import('../useHasActiveMembership'));
  useMyMembershipsMock.mockReset();
  useAuthStoreMock.mockClear();
  useAuthStoreMock.mockImplementation(
    (selector: (state: { user: { id: string } | null }) => unknown) =>
      selector({ user: { id: 'user-1' } })
  );
});

const row = (
  household_id: string,
  status: HouseholdMember['status']
): HouseholdMember =>
  ({ household_id, user_id: 'user-1', status }) as HouseholdMember;

describe('useHasActiveMembership', () => {
  it('is true for one active membership', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [row('household-a', HOUSEHOLD_MEMBER_STATUSES.ACTIVE)],
      isLoading: false,
    });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: true,
      isLoading: false,
    });
  });

  // THE case this hook exists for. `useIsOnboarded().isPastMember` answers
  // only for the resolved household, which for this nanny may well be the
  // family that ended — but she still works for the other one.
  it('is true when one household ended and another is still live', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        row('household-a', HOUSEHOLD_MEMBER_STATUSES.REMOVED),
        row('household-b', HOUSEHOLD_MEMBER_STATUSES.ACTIVE),
      ],
      isLoading: false,
    });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: true,
      isLoading: false,
    });
  });

  it('is false when every membership is removed', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        row('household-a', HOUSEHOLD_MEMBER_STATUSES.REMOVED),
        row('household-b', HOUSEHOLD_MEMBER_STATUSES.REMOVED),
      ],
      isLoading: false,
    });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: false,
      isLoading: false,
    });
  });

  // A candidate has redeemed a code and is waiting on the family to accept.
  // She is not removed, and the availability she sets is exactly what that
  // family reads while deciding — treating her as "no live household" would
  // be the same class of bug in a new place.
  it('counts a candidate membership as live', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [row('household-a', HOUSEHOLD_MEMBER_STATUSES.CANDIDATE)],
      isLoading: false,
    });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current.hasActiveMembership).toBe(true);
  });

  it('ignores other users rows', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        {
          household_id: 'household-a',
          user_id: 'someone-else',
          status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        } as HouseholdMember,
      ],
      isLoading: false,
    });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: false,
      isLoading: false,
    });
  });

  it('reports isLoading while memberships are loading', () => {
    useMyMembershipsMock.mockReturnValue({ data: undefined, isLoading: true });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: false,
      isLoading: true,
    });
  });

  it('reports isLoading when the read settled with no data (errored/disabled)', () => {
    useMyMembershipsMock.mockReturnValue({ data: undefined, isLoading: false });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: false,
      isLoading: true,
    });
  });

  // Same fix as useCanWriteHousehold's: a null viewer is UNKNOWN, not "no
  // memberships" — otherwise the row scan below matches nothing and returns a
  // confident false from an input that says only "we don't know who is asking".
  it('reports isLoading when the viewer id is not resolved yet', () => {
    useAuthStoreMock.mockImplementation(
      (selector: (state: { user: { id: string } | null }) => unknown) =>
        selector({ user: null })
    );
    useMyMembershipsMock.mockReturnValue({
      data: [row('household-a', HOUSEHOLD_MEMBER_STATUSES.ACTIVE)],
      isLoading: false,
    });
    const { result } = renderHook(() => useHasActiveMembership());
    expect(result.current).toEqual({
      hasActiveMembership: false,
      isLoading: true,
    });
  });
});
