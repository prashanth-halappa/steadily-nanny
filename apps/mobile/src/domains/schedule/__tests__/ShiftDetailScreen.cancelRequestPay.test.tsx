/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.cancelRequestPay.test
 *
 * R1: the nanny responding to a pending cancel request sees the same pay
 * sentence the parent saw in the confirm dialog — the person whose pay is
 * at stake is not left guessing.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from './mockAlertDialog';

mockAlertDialogPrimitive();

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
    i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: mock() },
}));

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
const CARER_ID = '55555555-5555-4555-8555-555555555555';
const PARENT_ID = '77777777-7777-4777-8777-777777777777';
const CANCEL_REQ_ID = '33333333-3333-4333-8333-333333333333';
const TIME_REQ_ID = '44444444-4444-4444-8444-444444444444';

const NOW = Date.now();
const startsAt = new Date(NOW + 2 * 3_600_000).toISOString();

const baseShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  starts_at: startsAt,
  ends_at: new Date(Date.parse(startsAt) + 5 * 3_600_000).toISOString(),
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

const paidArrangement = {
  id: 'arr-1',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  rate_minor: 1200,
  currency: 'USD',
  cancellation_paid_within_hours: 24,
};

function makeChangeRequest(
  id: string,
  kind: 'cancel' | 'time_change',
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    id,
    shift_id: SHIFT_ID,
    requested_by: PARENT_ID,
    kind,
    proposed_starts_at: null,
    proposed_ends_at: null,
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
  mockUseShiftChangeRequests = mock(() => ({ data: [], isLoading: false }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: () => ({ data: baseShift, isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useCurrentPayArrangement', () => ({
    useCurrentPayArrangement: () => ({
      data: paidArrangement,
      isLoading: false,
    }),
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
  mock.module('@/src/hooks/queries/useHouseholds', () => ({
    useHouseholds: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: mockUseShiftChangeRequests,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({
      role: 'nanny',
      status: 'onboarded',
      // Pattern A: role is resolved against the SHIFT's household.
      membershipRole: 'nanny',
      householdId: HOUSEHOLD_ID,
    }),
  }));
  mock.module('@/src/hooks/queries/useUserProfile', () => ({
    useUserProfile: () => ({
      data: { timezone: 'America/New_York', week_starts_on: 1 },
      isLoading: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/mutations/useUpdateShift', () => ({
    useUpdateShift: () => ({
      mutateAsync: mock(() => Promise.resolve({})),
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
      selector({ session: { user: { id: CARER_ID } } }),
  }));
  mock.module('@/src/lib/toast', () => ({ showSuccessToast: mock() }));

  const mod = await import('../components/ShiftDetailScreen');
  ShiftDetailScreen = mod.ShiftDetailScreen;
});

beforeEach(() => {
  mockUseShiftChangeRequests.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
});

describe('ShiftDetailScreen — cancel request pay sentence on the request card', () => {
  it('renders the pay sentence on a pending cancel request', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [makeChangeRequest(CANCEL_REQ_ID, 'cancel')],
      isLoading: false,
    }));

    const { getByTestId } = render(<ShiftDetailScreen />);
    const payLine = getByTestId(`shift-change-cancel-pay-${CANCEL_REQ_ID}`);

    expect(String(payLine.props.children)).toContain('detail.cancelPayPaid');
  });

  it('does not render the pay sentence on a pending time_change request', () => {
    mockUseShiftChangeRequests.mockImplementation(() => ({
      data: [makeChangeRequest(TIME_REQ_ID, 'time_change')],
      isLoading: false,
    }));

    const { queryByTestId } = render(<ShiftDetailScreen />);

    expect(queryByTestId(`shift-change-cancel-pay-${TIME_REQ_ID}`)).toBeNull();
  });
});
