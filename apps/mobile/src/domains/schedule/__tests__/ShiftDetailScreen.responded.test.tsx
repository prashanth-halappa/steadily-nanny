/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.responded.test
 *
 * Pattern B — change-request section renders for non-pending rows too;
 * declined requests keep message + response_message without action buttons.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

let ShiftDetailScreen: typeof import('../components/ShiftDetailScreen').ShiftDetailScreen;
let mockUseShift: ReturnType<typeof mock>;
let mockUseShiftEvents: ReturnType<typeof mock>;
let mockUseShiftChangeRequests: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseUpdateShift: ReturnType<typeof mock>;
let mockUseCreateShiftChangeRequest: ReturnType<typeof mock>;
let mockUseRespondToShiftChangeRequest: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PENDING_ID = '33333333-3333-4333-8333-333333333333';
const DECLINED_ID = '44444444-4444-4444-8444-444444444444';

const baseShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: '55555555-5555-4555-8555-555555555555',
  starts_at: '2026-08-03T13:00:00.000Z',
  ends_at: '2026-08-03T21:00:00.000Z',
  timezone: 'America/New_York',
  local_date: '2026-08-03',
  kind: 'recurring',
  status: 'confirmed',
  source_pattern_id: null,
  origin: 'system_generated',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  ical_uid: 'shift-1@steadily',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

function makeChangeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PENDING_ID,
    shift_id: SHIFT_ID,
    requested_by: null,
    kind: 'time_change',
    proposed_starts_at: null,
    proposed_ends_at: null,
    message: 'Can we start later?',
    response_message: null,
    status: 'pending',
    responded_by: null,
    responded_at: null,
    created_at: '2026-08-02T10:00:00.000Z',
    updated_at: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  mockUseShift = mock(() => ({ data: baseShift, isLoading: false }));
  mockUseShiftEvents = mock(() => ({ data: [], isLoading: false }));
  mockUseShiftChangeRequests = mock(() => ({ data: [], isLoading: false }));
  mockUseIsOnboarded = mock(() => ({
    role: 'parent',
    status: 'onboarded',
  }));
  mockUseUpdateShift = mock(() => ({
    mutateAsync: mock(() => Promise.resolve(baseShift)),
    isPending: false,
  }));
  mockUseCreateShiftChangeRequest = mock(() => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }));
  mockUseRespondToShiftChangeRequest = mock(() => ({
    mutateAsync: mock(() => Promise.resolve({})),
    isPending: false,
  }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: mockUseShiftEvents,
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: mockUseShiftChangeRequests,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          household_id: HOUSEHOLD_ID,
          user_id: '66666666-6666-4666-8666-666666666666',
          role: 'parent',
          can_edit: true,
          status: 'active',
          display_name_override: 'Alex',
          colour: null,
          joined_at: '2026-01-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: mockUseUpdateShift,
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: mockUseCreateShiftChangeRequest,
  }));
  mock.module('@/src/hooks/mutations/useRespondToShiftChangeRequest', () => ({
    useRespondToShiftChangeRequest: mockUseRespondToShiftChangeRequest,
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockUseShift.mockImplementation(() => ({
    data: baseShift,
    isLoading: false,
  }));
  mockUseShiftChangeRequests.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
});

describe('ShiftDetailScreen change requests (responded)', () => {
  it('renders the changes section when only non-pending requests exist', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [
        makeChangeRequest({
          id: DECLINED_ID,
          status: 'declined',
          requested_by: '66666666-6666-4666-8666-666666666666',
          responded_by: '66666666-6666-4666-8666-666666666666',
          message: 'Please cancel',
          response_message: 'Sorry, cannot do that',
        }),
      ],
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-changes')).toBeTruthy();
    expect(getByTestId(`shift-change-message-${DECLINED_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-response-${DECLINED_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-raised-by-${DECLINED_ID}`)).toBeTruthy();
    expect(
      getByTestId(`shift-change-responded-by-${DECLINED_ID}`)
    ).toBeTruthy();
    expect(queryByTestId(`shift-change-accept-${DECLINED_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-decline-${DECLINED_ID}`)).toBeNull();
  });

  it('shows accept/decline buttons only for pending requests', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [
        makeChangeRequest({
          id: PENDING_ID,
          status: 'pending',
          message: 'Need more time',
        }),
      ],
      isLoading: false,
    }));

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId(`shift-change-accept-${PENDING_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-decline-${PENDING_ID}`)).toBeTruthy();
  });

  it('renders both pending and responded rows in a mixed list', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [
        makeChangeRequest({
          id: PENDING_ID,
          status: 'pending',
          message: 'Still open',
        }),
        makeChangeRequest({
          id: DECLINED_ID,
          status: 'declined',
          message: 'Already closed',
          response_message: 'Not this week',
        }),
      ],
      isLoading: false,
    }));

    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId('shift-detail-changes')).toBeTruthy();
    expect(getByTestId(`shift-change-message-${PENDING_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-accept-${PENDING_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-message-${DECLINED_ID}`)).toBeTruthy();
    expect(getByTestId(`shift-change-response-${DECLINED_ID}`)).toBeTruthy();
    expect(queryByTestId(`shift-change-accept-${DECLINED_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-decline-${DECLINED_ID}`)).toBeNull();
  });
});
