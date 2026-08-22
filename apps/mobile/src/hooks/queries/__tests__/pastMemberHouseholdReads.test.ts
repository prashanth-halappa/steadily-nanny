/**
 * @module hooks/queries/__tests__/pastMemberHouseholdReads.test
 *
 * The household-scoped reads 404 for a removed member — the server refuses
 * them by design while it keeps payroll readable. React Query re-asks on
 * every mount/focus, so an ungated hook turns that refusal into a sustained
 * request loop that trips the rate limiter and freezes Today. These hooks
 * must not ask once membership resolves to `removed`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  HOUSEHOLD_MEMBER_STATUSES,
  type HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HOUSEHOLD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FROM = '2026-08-10T00:00:00.000Z';
const TO = '2026-08-13T00:00:00.000Z';

const useMyMembershipsMock = mock(
  () =>
    ({ data: undefined, isLoading: true }) as {
      data: HouseholdMember[] | undefined;
      isLoading: boolean;
    }
);
const listMembersMock = mock(() => Promise.resolve([]));
const shiftRangeMock = mock(() => Promise.resolve([]));

mock.module('@/src/hooks/queries/useMyMemberships', () => ({
  useMyMemberships: useMyMembershipsMock,
}));
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/shifts', () => ({
  shiftApi: { range: shiftRangeMock },
}));

function membershipsResolvedAs(status: HouseholdMember['status']) {
  useMyMembershipsMock.mockReturnValue({
    data: [
      { household_id: HOUSEHOLD_ID, user_id: USER_ID, status },
    ] as HouseholdMember[],
    isLoading: false,
  });
}

let useHouseholdMembers: typeof import('../useHouseholdMembers').useHouseholdMembers;
let useShiftsRange: typeof import('../useShiftsRange').useShiftsRange;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  ({ useHouseholdMembers } = await import('../useHouseholdMembers'));
  ({ useShiftsRange } = await import('../useShiftsRange'));
  ({ useAuthStore } = await import('@/src/store/auth'));

  useMyMembershipsMock.mockReset();
  listMembersMock.mockReset();
  listMembersMock.mockImplementation(() => Promise.resolve([]));
  shiftRangeMock.mockReset();
  shiftRangeMock.mockImplementation(() => Promise.resolve([]));

  useAuthStore.setState({
    session: { user: { id: USER_ID } } as unknown as never,
    user: { id: USER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('household-scoped reads are gated on membership', () => {
  it('useHouseholdMembers does not fetch for a removed member', () => {
    membershipsResolvedAs(HOUSEHOLD_MEMBER_STATUSES.REMOVED);

    renderHookWithProviders(() => useHouseholdMembers(HOUSEHOLD_ID));

    expect(listMembersMock).not.toHaveBeenCalled();
  });

  it('useHouseholdMembers does not fetch while memberships are still loading', () => {
    useMyMembershipsMock.mockReturnValue({ data: undefined, isLoading: true });

    renderHookWithProviders(() => useHouseholdMembers(HOUSEHOLD_ID));

    expect(listMembersMock).not.toHaveBeenCalled();
  });

  it('useHouseholdMembers still fetches for an active member', async () => {
    membershipsResolvedAs(HOUSEHOLD_MEMBER_STATUSES.ACTIVE);

    renderHookWithProviders(() => useHouseholdMembers(HOUSEHOLD_ID));

    await waitFor(() =>
      expect(listMembersMock).toHaveBeenCalledWith(HOUSEHOLD_ID)
    );
  });

  it('useShiftsRange does not fetch for a removed member', () => {
    membershipsResolvedAs(HOUSEHOLD_MEMBER_STATUSES.REMOVED);

    renderHookWithProviders(() => useShiftsRange(HOUSEHOLD_ID, FROM, TO));

    expect(shiftRangeMock).not.toHaveBeenCalled();
  });

  it('useShiftsRange does not fetch while memberships are still loading', () => {
    useMyMembershipsMock.mockReturnValue({ data: undefined, isLoading: true });

    renderHookWithProviders(() => useShiftsRange(HOUSEHOLD_ID, FROM, TO));

    expect(shiftRangeMock).not.toHaveBeenCalled();
  });

  it('useShiftsRange still fetches for an active member', async () => {
    membershipsResolvedAs(HOUSEHOLD_MEMBER_STATUSES.ACTIVE);

    renderHookWithProviders(() => useShiftsRange(HOUSEHOLD_ID, FROM, TO));

    await waitFor(() =>
      expect(shiftRangeMock).toHaveBeenCalledWith(HOUSEHOLD_ID, FROM, TO)
    );
  });
});
