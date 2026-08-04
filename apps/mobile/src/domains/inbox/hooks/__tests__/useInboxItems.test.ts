/**
 * @module domains/inbox/hooks/__tests__/useInboxItems.test
 *
 * Behavioural coverage for the isError OR-chain — gutting any term must
 * fail a test. Empty-success (`items: []`, `isError: false`) is the
 * anti-pattern these cases guard against.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD = {
  id: 'hh-1',
  name: 'Test Household',
  timezone: 'UTC',
};

const listPatterns = mock(() => Promise.resolve([] as unknown[]));
const listTimesheets = mock(() => Promise.resolve([] as unknown[]));
const listPendingChangeRequests = mock(() => Promise.resolve([] as unknown[]));
const listPendingApprovals = mock(() => Promise.resolve([] as unknown[]));

let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let useInboxItems: typeof import('../useInboxItems').useInboxItems;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeAll(async () => {
  mockUseActiveHousehold = mock(() => ({
    household: HOUSEHOLD,
    householdId: HOUSEHOLD.id,
    households: [HOUSEHOLD],
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }));
  mockUseIsOnboarded = mock(() => ({
    role: 'parent' as const,
    status: 'onboarded' as const,
  }));

  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: mockUseActiveHousehold,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/api/endpoints/schedulePatterns', () => ({
    schedulePatternApi: { list: listPatterns },
  }));
  mock.module('@/src/api/endpoints/timesheets', () => ({
    timesheetApi: { list: listTimesheets },
  }));
  mock.module('@/src/api/endpoints/me', () => ({
    meApi: {
      listPendingChangeRequests,
      listShifts: mock(() => Promise.resolve([])),
    },
  }));
  mock.module('@/src/domains/inbox/api', () => ({
    listPendingApprovals,
  }));

  useInboxItems = (await import('../useInboxItems')).useInboxItems;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;
});

beforeEach(() => {
  listPatterns.mockReset();
  listTimesheets.mockReset();
  listPendingChangeRequests.mockReset();
  listPendingApprovals.mockReset();
  listPatterns.mockResolvedValue([]);
  listTimesheets.mockResolvedValue([]);
  listPendingChangeRequests.mockResolvedValue([]);
  listPendingApprovals.mockResolvedValue([]);

  mockUseActiveHousehold.mockImplementation(() => ({
    household: HOUSEHOLD,
    householdId: HOUSEHOLD.id,
    households: [HOUSEHOLD],
    setActiveHouseholdId: mock(),
    isLoading: false,
    isError: false,
  }));
  mockUseIsOnboarded.mockImplementation(() => ({
    role: 'parent' as const,
    status: 'onboarded' as const,
  }));

  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useInboxItems isError channel', () => {
  it('surfaces isError when households fail (active.isError) — not empty-success', async () => {
    mockUseActiveHousehold.mockImplementation(() => ({
      household: null,
      householdId: null,
      households: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: true,
    }));

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('surfaces isError when change-requests query fails', async () => {
    listPendingChangeRequests.mockRejectedValue(new Error('cr boom'));

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('surfaces isError when timesheets query fails', async () => {
    listTimesheets.mockRejectedValue(new Error('ts boom'));

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('isError stays false on empty success — distinguishes from failure', async () => {
    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});
