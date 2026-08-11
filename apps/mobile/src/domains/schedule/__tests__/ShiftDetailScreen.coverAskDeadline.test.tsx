/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.coverAskDeadline.test
 *
 * §5.3/M21 — the deadline sentence, byte-identical to the inbox item's, and
 * the expired/withdrawn read-only states. `cover_ask_expires_at` is 3-T3's
 * wire; the rendering is this slice's.
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
let mockUseShift: ReturnType<typeof mock>;

const SHIFT_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_ID = '55555555-5555-4555-8555-555555555555';

const baseShift = {
  id: SHIFT_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  starts_at: '2026-08-14T13:00:00.000Z',
  ends_at: '2026-08-14T21:00:00.000Z',
  timezone: 'America/New_York',
  local_date: '2026-08-14',
  kind: 'extra',
  status: 'pending',
  source_pattern_id: null,
  origin: 'parent_proposed',
  is_short_notice: false,
  note: null,
  reason: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_paid: false,
  cancellation_message: null,
  cover_ask_expires_at: null as string | null,
  ical_uid: 'shift-1@steadily',
  sequence: 0,
  created_by: null,
  created_at: '2026-08-10T00:00:00.000Z',
  updated_at: '2026-08-10T00:00:00.000Z',
};

/** Fixed "now" the whole suite renders against — 2026-08-12T12:00:00Z. */
const NOW = new Date('2026-08-12T12:00:00.000Z');
setSystemTime(NOW);
afterAll(() => setSystemTime());

beforeAll(async () => {
  mockUseShift = mock(() => ({ data: baseShift, isLoading: false }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ back: mock(), push: mock() }),
    useLocalSearchParams: () => ({ shiftId: SHIFT_ID }),
    router: { push: mock(), replace: mock(), back: mock(), navigate: mock() },
  }));
  mock.module('@/src/hooks/queries/useShift', () => ({
    useShift: mockUseShift,
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
  mock.module('@/src/hooks/queries/useShiftEvents', () => ({
    useShiftEvents: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useShiftChangeRequests', () => ({
    useShiftChangeRequests: () => ({ data: [], isLoading: false }),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: () => ({ role: 'nanny', status: 'onboarded' }),
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
    useUpdateShift: () => ({ mutateAsync: mock(), isPending: false }),
  }));
  mock.module('@/src/hooks/mutations/useCreateShiftChangeRequest', () => ({
    useCreateShiftChangeRequest: () => ({
      mutateAsync: mock(),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRespondToShiftChangeRequest', () => ({
    useRespondToShiftChangeRequest: () => ({
      mutateAsync: mock(),
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useAcceptShift', () => ({
    useAcceptShift: () => ({ mutateAsync: mock(), isPending: false }),
  }));
  mock.module('@/src/hooks/mutations/useDeclineShift', () => ({
    useDeclineShift: () => ({ mutateAsync: mock(), isPending: false }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawChangeRequest', () => ({
    useWithdrawChangeRequest: () => ({ mutateAsync: mock(), isPending: false }),
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
  mockUseShift.mockImplementation(() => ({
    data: baseShift,
    isLoading: false,
  }));
});

describe('ShiftDetailScreen — cover-ask deadline (§5.3/M21)', () => {
  it('renders "Answer by" for a pending assigned ask with an expiry stamped', () => {
    mockUseShift.mockImplementation(() => ({
      data: { ...baseShift, cover_ask_expires_at: '2026-08-15T18:00:00.000Z' },
      isLoading: false,
    }));
    const { getByTestId } = render(<ShiftDetailScreen />);
    expect(getByTestId('shift-detail-answer-by')).toBeTruthy();
  });

  it('renders nothing when there is no expiry stamped (legacy/no-carer ask)', () => {
    const { queryByTestId } = render(<ShiftDetailScreen />);
    expect(queryByTestId('shift-detail-answer-by')).toBeNull();
  });

  it("goes destructive inside the urgent window, matching NeedsAttentionCard's threshold", () => {
    // 6h out — inside COVER_ASK_URGENT_HOURS (12h).
    mockUseShift.mockImplementation(() => ({
      data: { ...baseShift, cover_ask_expires_at: '2026-08-12T18:00:00.000Z' },
      isLoading: false,
    }));
    const { getByTestId } = render(<ShiftDetailScreen />);
    const node = getByTestId('shift-detail-answer-by');
    const layers = Array.isArray(node.props.style)
      ? node.props.style.flat()
      : [node.props.style];
    const merged = Object.assign({}, ...layers.filter(Boolean));
    // text-destructive resolves to a non-muted colour; assert the className
    // carries the token rather than a resolved hex (avoids coupling to the
    // palette).
    expect(node.props.className ?? '').toContain('destructive');
    void merged;
  });

  it('renders the expired read-only reason and hides Accept — no button that only returns an error', () => {
    mockUseShift.mockImplementation(() => ({
      data: {
        ...baseShift,
        status: 'cancelled',
        cancelled_by: null,
        cover_ask_expires_at: '2026-08-11T18:00:00.000Z',
      },
      isLoading: false,
    }));
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);
    expect(getByTestId('shift-detail-ask-expired')).toBeTruthy();
    expect(queryByTestId('shift-detail-accept')).toBeNull();
    expect(queryByTestId('shift-detail-decline')).toBeNull();
    expect(queryByTestId('shift-detail-counter')).toBeNull();
  });

  it('renders the withdrawn read-only reason for a parent-cancelled ask', () => {
    mockUseShift.mockImplementation(() => ({
      data: {
        ...baseShift,
        status: 'cancelled',
        cancelled_by: CARER_ID,
        cover_ask_expires_at: '2026-08-11T18:00:00.000Z',
      },
      isLoading: false,
    }));
    const { getByTestId, queryByTestId } = render(<ShiftDetailScreen />);
    expect(getByTestId('shift-detail-ask-withdrawn')).toBeTruthy();
    expect(queryByTestId('shift-detail-ask-expired')).toBeNull();
    expect(queryByTestId('shift-detail-accept')).toBeNull();
  });
});
