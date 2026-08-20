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
  (selector: (state: { user: { id: string } }) => unknown) => {
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

let useCanWriteHousehold: typeof import('../useCanWriteHousehold').useCanWriteHousehold;

beforeEach(async () => {
  ({ useCanWriteHousehold } = await import('../useCanWriteHousehold'));
  useMyMembershipsMock.mockReset();
  useAuthStoreMock.mockClear();
});

describe('useCanWriteHousehold', () => {
  it('returns canWrite true, isPastMember false, isLoading false for active membership in target household', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        {
          household_id: 'household-a',
          user_id: 'user-1',
          status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        },
      ] as HouseholdMember[],
      isLoading: false,
    });
    const { result } = renderHook(() => useCanWriteHousehold('household-a'));
    expect(result.current).toEqual({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    });
  });

  it('returns canWrite false, isPastMember true for removed membership in target household', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        {
          household_id: 'household-a',
          user_id: 'user-1',
          status: HOUSEHOLD_MEMBER_STATUSES.REMOVED,
        },
      ] as HouseholdMember[],
      isLoading: false,
    });
    const { result } = renderHook(() => useCanWriteHousehold('household-a'));
    expect(result.current).toEqual({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });
  });

  it('resolves correctly when user is active in A but removed in B', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        {
          household_id: 'household-a',
          user_id: 'user-1',
          status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        },
        {
          household_id: 'household-b',
          user_id: 'user-1',
          status: HOUSEHOLD_MEMBER_STATUSES.REMOVED,
        },
      ] as HouseholdMember[],
      isLoading: false,
    });

    const { result: resultB } = renderHook(() =>
      useCanWriteHousehold('household-b')
    );
    expect(resultB.current).toEqual({
      canWrite: false,
      isPastMember: true,
      isLoading: false,
    });

    const { result: resultA } = renderHook(() =>
      useCanWriteHousehold('household-a')
    );
    expect(resultA.current).toEqual({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    });
  });

  it('returns canWrite false, isPastMember false, isLoading true when memberships are loading', () => {
    useMyMembershipsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    const { result } = renderHook(() => useCanWriteHousehold('household-a'));
    expect(result.current).toEqual({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });
  });

  it('treats a failed memberships read as unknown, never as a known answer', () => {
    // The query can settle with no data — it errored, or it is disabled
    // because the session has not resolved. `isLoading` is false in both
    // cases, so a naive read reports "she is not a past member and cannot
    // write" as though it were established fact. This codebase's rule
    // (useIsOnboarded) is that unknown fails toward WAIT, never toward an
    // assumption: a screen must not render a closure it has not confirmed.
    useMyMembershipsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    const { result } = renderHook(() => useCanWriteHousehold('household-a'));
    expect(result.current).toEqual({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });
  });

  it('returns canWrite false, isLoading true when householdId is null/undefined', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        {
          household_id: 'household-a',
          user_id: 'user-1',
          status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        },
      ] as HouseholdMember[],
      isLoading: false,
    });

    const { result: resultNull } = renderHook(() => useCanWriteHousehold(null));
    expect(resultNull.current).toEqual({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });

    const { result: resultUndefined } = renderHook(() =>
      useCanWriteHousehold(undefined)
    );
    expect(resultUndefined.current).toEqual({
      canWrite: false,
      isPastMember: false,
      isLoading: true,
    });
  });

  it('returns canWrite false when there is no membership row for that household', () => {
    useMyMembershipsMock.mockReturnValue({
      data: [
        {
          household_id: 'household-b',
          user_id: 'user-1',
          status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        },
      ] as HouseholdMember[],
      isLoading: false,
    });
    const { result } = renderHook(() => useCanWriteHousehold('household-a'));
    expect(result.current).toEqual({
      canWrite: false,
      isPastMember: false,
      isLoading: false,
    });
  });
});
