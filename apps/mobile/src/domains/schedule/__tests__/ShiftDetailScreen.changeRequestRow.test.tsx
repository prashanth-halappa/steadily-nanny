/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.changeRequestRow.test
 *
 * D75 + D76 — the change-request row on the shift detail screen.
 *
 * D75: the awaiting line used ONE key ("Waiting for the nanny to confirm")
 * for any pending request the reader raised, so a nanny's counter-offer —
 * the only kind she can raise — told her she was waiting on herself. It now
 * forks on the REQUESTER's role, mirroring the server: a parent's request is
 * answered by the assigned carer, a nanny's by a parent (i.e. the family).
 *
 * D76: the row's only clock reading was `created_at`, so a parent pressed
 * Accept on a counter-offer whose proposed window had never been on screen.
 *
 * `t` is key-echoed by `bun.setup.ts`, so these assert on the i18n KEY, not
 * on copy — the interpolated `{{name}}` is covered by the shared-copy check
 * in `ShiftDetailScreen.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

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
let mockUseShiftChangeRequests: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PARENT_ID = '44444444-4444-4444-8444-444444444444';
const NANNY_ID = '55555555-5555-4555-8555-555555555555';

/** Who is reading the screen — flipped per test before `render`. */
let readerId = PARENT_ID;

const baseShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: NANNY_ID,
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
    id: REQUEST_ID,
    shift_id: SHIFT_ID,
    requested_by: PARENT_ID,
    kind: 'time_change',
    proposed_starts_at: '2026-08-03T14:00:00.000Z',
    proposed_ends_at: '2026-08-03T22:00:00.000Z',
    message: null,
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
  mockUseShiftChangeRequests = mock(() => ({
    data: [makeChangeRequest()],
    isLoading: false,
  }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => ({ data: baseShift, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: () => ({ data: null, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useRestrictedAction', () => ({
    useRestrictedAction: () => ({ disabled: false, reason: null }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: mockUseShiftChangeRequests,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      role: 'parent',
      status: 'onboarded',
      membershipRole: 'owner',
      householdId: HOUSEHOLD_ID,
    }),
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  // The roster is what D75 forks on — both sides present and resolved.
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({
      data: [
        { user_id: PARENT_ID, role: 'owner', display_name: 'Sam' },
        { user_id: NANNY_ID, role: 'nanny', display_name: 'Andrea' },
      ],
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mock(() => Promise.resolve(baseShift)),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRespondToShiftChangeRequest', () => ({
    useRespondToShiftChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useAcceptShift', () => ({
    useAcceptShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useDeclineShift', () => ({
    useDeclineShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawChangeRequest', () => ({
    useWithdrawChangeRequest: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
      isPending: false,
    }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ session: { user: { id: readerId } } }),
  }));
  mock.module('@/src/lib/toast', () => ({
    showSuccessToast: mock(),
  }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  readerId = PARENT_ID;
  mockUseShiftChangeRequests.mockImplementation(() => ({
    data: [makeChangeRequest()],
    isLoading: false,
  }));
});

describe('D75 — the awaiting line names who has to answer', () => {
  it('tells the parent who raised a time_change that the carer has to confirm', () => {
    const { getByTestId, queryByText } = render(<ShiftDetailScreen />);

    expect(getByTestId(`shift-change-awaiting-${REQUEST_ID}`)).toBeTruthy();
    expect(queryByText('detail.awaitingCarerConfirm')).toBeTruthy();
    expect(queryByText('detail.awaitingFamilyConfirm')).toBeNull();
  });

  it('tells the nanny who raised a counter_offer that the FAMILY has to confirm — never herself', () => {
    readerId = NANNY_ID;
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [
        makeChangeRequest({ requested_by: NANNY_ID, kind: 'counter_offer' }),
      ],
      isLoading: false,
    }));

    const { getByTestId, queryByText } = render(<ShiftDetailScreen />);

    expect(getByTestId(`shift-change-awaiting-${REQUEST_ID}`)).toBeTruthy();
    expect(queryByText('detail.awaitingFamilyConfirm')).toBeTruthy();
    expect(queryByText('detail.awaitingCarerConfirm')).toBeNull();
  });

  it('says nothing on a request someone else raised — that side has buttons, not a wait', () => {
    readerId = NANNY_ID;

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId(`shift-change-awaiting-${REQUEST_ID}`)).toBeNull();
    expect(queryByTestId(`shift-change-accept-${REQUEST_ID}`)).toBeTruthy();
  });
});

describe('D76 — the row shows the time being accepted', () => {
  it('renders the proposed window for a counter_offer carrying both instants', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [
        makeChangeRequest({ requested_by: NANNY_ID, kind: 'counter_offer' }),
      ],
      isLoading: false,
    }));

    const { getByTestId } = render(<ShiftDetailScreen />);

    expect(getByTestId(`shift-change-proposed-${REQUEST_ID}`)).toBeTruthy();
  });

  it('omits the proposed window for a cancel, which proposes no time', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [
        makeChangeRequest({
          kind: 'cancel',
          proposed_starts_at: null,
          proposed_ends_at: null,
        }),
      ],
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId(`shift-change-proposed-${REQUEST_ID}`)).toBeNull();
    // The raised-at stamp is still there — and now labelled, so it cannot be
    // misread as the proposed time.
    expect(queryByTestId(`shift-change-created-${REQUEST_ID}`)).toBeTruthy();
  });

  it('labels the raised-at timestamp rather than leaving a bare clock reading', () => {
    const { queryByText } = render(<ShiftDetailScreen />);

    expect(queryByText('detail.raisedAt')).toBeTruthy();
  });
});
