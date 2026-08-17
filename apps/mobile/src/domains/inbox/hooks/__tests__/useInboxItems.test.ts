/**
 * @module domains/inbox/hooks/__tests__/useInboxItems.test
 *
 * Behavioural coverage for the isError OR-chain — gutting any term must
 * fail a test. Empty-success (`items: []`, `isError: false`) is the
 * anti-pattern these cases guard against.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD = {
  id: 'hh-1',
  name: 'Test Household',
  timezone: 'UTC',
};

// UTC+14 — the world's furthest-ahead zone, deliberately: at a fixed instant
// late in a UTC day it is already TOMORROW there, so its own "today" reliably
// disagrees with HOUSEHOLD's (the active one).
const HOUSEHOLD_B = {
  id: 'hh-2',
  name: 'Kiribati Household',
  timezone: 'Pacific/Kiritimati',
};

const listPatterns = mock(() => Promise.resolve([] as unknown[]));
const listTimesheets = mock(() => Promise.resolve([] as unknown[]));
const listPendingChangeRequests = mock(() => Promise.resolve([] as unknown[]));
const listMeShifts = mock(() => Promise.resolve([] as unknown[]));
const listMembers = mock(() => Promise.resolve([] as unknown[]));
const getCurrentProposal = mock(() => Promise.resolve(null as unknown));
const listUnsettledReimbursements = mock(() =>
  Promise.resolve([] as unknown[])
);

const CARER = '44444444-4444-4444-8444-444444444444';
const PROPOSAL = {
  id: '55555555-5555-4555-8555-555555555555',
  household_id: HOUSEHOLD.id,
  carer_id: CARER,
  direction: 'carer',
  status: 'proposed',
  carer_display_name: 'Marisol',
  created_at: '2026-08-24T09:00:00.000Z',
  weekly_equivalent_minor: 154000,
  terms: { rate_minor: 2800, currency: 'USD' },
};

let mockUseActiveHousehold: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let useInboxItems: typeof import('../useInboxItems').useInboxItems;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeAll(async () => {
  mockUseActiveHousehold = mock(() => ({
    household: HOUSEHOLD,
    householdId: HOUSEHOLD.id,
    households: [HOUSEHOLD],
    pastHouseholds: [],
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
      listShifts: listMeShifts,
    },
  }));
  // §7.1 — the proposal read is per (household, carer), so a parent needs the
  // household's carer roster before she can ask about anyone's terms.
  mock.module('@/src/api/endpoints/household', () => ({
    householdApi: { listMembers },
  }));
  mock.module('@/src/api/endpoints/termsProposals', () => ({
    termsProposalApi: { getCurrent: getCurrentProposal },
  }));
  mock.module('@/src/api/endpoints/reimbursementSettlements', () => ({
    reimbursementSettlementApi: { listUnsettled: listUnsettledReimbursements },
  }));

  useInboxItems = (await import('../useInboxItems')).useInboxItems;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;
});

beforeEach(() => {
  listPatterns.mockReset();
  listTimesheets.mockReset();
  listPendingChangeRequests.mockReset();
  listMeShifts.mockReset();
  listMembers.mockReset();
  getCurrentProposal.mockReset();
  listUnsettledReimbursements.mockReset();
  listMembers.mockResolvedValue([]);
  getCurrentProposal.mockResolvedValue(null);
  listUnsettledReimbursements.mockResolvedValue([]);
  listPatterns.mockResolvedValue([]);
  listTimesheets.mockResolvedValue([]);
  listPendingChangeRequests.mockResolvedValue([]);
  listMeShifts.mockResolvedValue([]);

  mockUseActiveHousehold.mockImplementation(() => ({
    household: HOUSEHOLD,
    householdId: HOUSEHOLD.id,
    households: [HOUSEHOLD],
    pastHouseholds: [],
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
      pastHouseholds: [],
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

  it('surfaces isError when the me/shifts fan-in fails', async () => {
    listMeShifts.mockRejectedValue(new Error('shifts boom'));

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('surfaces isError when a terms-proposal read fails', async () => {
    listMembers.mockResolvedValue([
      { user_id: CARER, role: 'nanny', status: 'active' },
    ]);
    getCurrentProposal.mockRejectedValue(new Error('proposal boom'));

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.items).toEqual([]);
  });

  it('surfaces isError when the carer roster a proposal read depends on fails', async () => {
    listMembers.mockRejectedValue(new Error('members boom'));

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('isError stays false on empty success — distinguishes from failure', async () => {
    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});

// D-38's redemption leaves the nanny a `candidate` member until the terms are
// accepted, so a roster filtered to `active` alone would hide the very
// proposal that decides it.
describe('useInboxItems terms proposals (§7.1)', () => {
  it('reaches a parent through the household carer roster, candidates included', async () => {
    listMembers.mockResolvedValue([
      { user_id: CARER, role: 'nanny', status: 'candidate' },
      { user_id: 'user-1', role: 'parent', status: 'active' },
    ]);
    getCurrentProposal.mockResolvedValue(PROPOSAL);

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.items[0]).toMatchObject({
      kind: 'terms_proposal',
      id: PROPOSAL.id,
      carerDisplayName: 'Marisol',
    });
    // One read per carer, never per parent.
    expect(getCurrentProposal).toHaveBeenCalledTimes(1);
    expect(getCurrentProposal).toHaveBeenCalledWith(HOUSEHOLD.id, CARER);
  });

  it('asks nothing about a removed member’s terms', async () => {
    listMembers.mockResolvedValue([
      { user_id: CARER, role: 'nanny', status: 'removed' },
    ]);

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getCurrentProposal).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });
});

// Pattern A: `todayISO`/`from`/`to` were computed once from the ACTIVE
// household's zone and applied to every household's staleness math and
// query window — the root cause behind NeedsAttentionCard/InboxScreen's
// mislabelled dates. Fixed at the source, here.
describe('useInboxItems — per-household today/window (Pattern A root)', () => {
  beforeEach(() => {
    mockUseActiveHousehold.mockImplementation(() => ({
      household: HOUSEHOLD,
      householdId: HOUSEHOLD.id,
      households: [HOUSEHOLD, HOUSEHOLD_B],
      pastHouseholds: [],
      setActiveHouseholdId: mock(),
      isLoading: false,
      isError: false,
    }));
    mockUseIsOnboarded.mockImplementation(() => ({
      role: 'nanny' as const,
      status: 'onboarded' as const,
    }));
  });

  it("computes stale_submitted_week's daysAgo against the WEEK'S OWN household today, not the active household's", async () => {
    // 23:00 UTC on the 11th — already the 12th in HOUSEHOLD_B's zone
    // (UTC+14), still the 11th in HOUSEHOLD's (active, UTC).
    setSystemTime(new Date('2026-08-11T23:00:00.000Z'));

    listTimesheets.mockImplementation((...args: unknown[]) => {
      const householdId = args[0] as string;
      return Promise.resolve(
        householdId === HOUSEHOLD_B.id
          ? [
              {
                id: 'ts-b',
                household_id: HOUSEHOLD_B.id,
                carer_id: 'user-1',
                week_start: '2026-07-14',
                status: 'submitted',
                query_note: null,
                total_minutes: 2000,
                // 14 days before the ACTIVE household's today (11 Aug) —
                // exactly AT the not-yet-stale boundary there — but 15 days
                // before HOUSEHOLD_B's own today (12 Aug), past it.
                updated_at: '2026-07-28T12:00:00.000Z',
              },
            ]
          : []
      );
    });

    const { result } = renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    setSystemTime();
    expect(result.current.items).toContainEqual(
      expect.objectContaining({ kind: 'stale_submitted_week', id: 'ts-b' })
    );
  });

  afterAll(() => setSystemTime());

  it('widens the me/shifts glance window past what the active household alone would query (min from, max to)', async () => {
    setSystemTime(new Date('2026-08-11T23:00:00.000Z'));

    // The OLD (buggy) single-zone bound: exactly what the active household
    // ALONE would have queried out to.
    const activeOnlyTo = wallClockToUtcIso(
      addLocalDays(localDateInZone(HOUSEHOLD.timezone), 21),
      '00:00',
      HOUSEHOLD.timezone
    );

    renderHookWithProviders(() => useInboxItems());

    await waitFor(() => expect(listMeShifts).toHaveBeenCalled());
    const [, actualTo] = listMeShifts.mock.calls[0] as unknown as [
      string,
      string,
    ];

    // HOUSEHOLD_B is a day ahead, so ITS OWN window ends later than the
    // active-only bound above — the actual call must reach at least that
    // far, never clip HOUSEHOLD_B's glance window to the active zone's.
    expect(Date.parse(actualTo)).toBeGreaterThan(Date.parse(activeOnlyTo));
    setSystemTime();
  });
});
