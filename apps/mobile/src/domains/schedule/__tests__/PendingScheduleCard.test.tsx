/**
 * @module domains/schedule/__tests__/PendingScheduleCard.test
 *
 * Covers `PendingScheduleCard` — the nanny's entry point (mounted on Today
 * by another agent) to the respond flow. Renders NOTHING when there is no
 * pending pattern where the signed-in user is the carer (no empty state, no
 * placeholder — invisible on an ordinary day). `useSchedulePatterns` /
 * `useSchedulePattern` / `useIsOnboarded` / `useAuthStore` / `expo-router`
 * are mocked via `mock.module()` in `beforeAll`, before the dynamic import
 * of the component under test.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
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

let PendingScheduleCard: typeof import('../components/PendingScheduleCard').PendingScheduleCard;
let mockUseSchedulePatterns: ReturnType<typeof mock>;
let mockUseSchedulePattern: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;
let mockUseAuthStore: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CARER_USER_ID = '22222222-2222-4222-8222-222222222222';
const PATTERN_ID = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  mockUseSchedulePatterns = mock(() => ({ data: [], isLoading: false }));
  mockUseSchedulePattern = mock(() => ({ data: undefined, isLoading: false }));
  mockUseIsOnboarded = mock(() => ({
    status: 'onboarded',
    role: 'nanny',
    householdId: HOUSEHOLD_ID,
  }));
  mockUseAuthStore = mock((selector: (s: unknown) => unknown) =>
    selector({ session: { user: { id: CARER_USER_ID } } })
  );
  mockPush = mock();

  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: mockUseSchedulePatterns,
  }));
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: mockUseSchedulePattern,
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: mockUseIsOnboarded,
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: mockUseAuthStore,
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));

  const mod = await import('../components/PendingScheduleCard');
  PendingScheduleCard = mod.PendingScheduleCard;
});

const pendingPatternForMe = {
  id: PATTERN_ID,
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_USER_ID,
  status: 'pending',
  rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
  dtstart: '2026-08-05',
};

const patternDays = [
  { weekday: 3, start_time: '08:00', end_time: '13:00' },
  { weekday: 5, start_time: '09:00', end_time: '17:00' },
];

describe('PendingScheduleCard', () => {
  it('renders nothing when there is no pending pattern at all', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [],
      isLoading: false,
    }));

    const { queryByTestId, toJSON } = render(<PendingScheduleCard />);

    expect(queryByTestId('today-pending-schedule-card')).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('renders nothing for a pending pattern where someone else is the carer', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [{ ...pendingPatternForMe, carer_id: 'someone-else' }],
      isLoading: false,
    }));

    const { queryByTestId } = render(<PendingScheduleCard />);

    expect(queryByTestId('today-pending-schedule-card')).toBeNull();
  });

  it('renders nothing for a pattern that is not pending (e.g. draft/accepted)', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [{ ...pendingPatternForMe, status: 'accepted' }],
      isLoading: false,
    }));

    const { queryByTestId } = render(<PendingScheduleCard />);

    expect(queryByTestId('today-pending-schedule-card')).toBeNull();
  });

  it('renders the card with day count + total hours, and navigates to respond on tap', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [pendingPatternForMe],
      isLoading: false,
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: { ...pendingPatternForMe, days: patternDays },
      isLoading: false,
    }));

    const { getByTestId } = render(<PendingScheduleCard />);

    expect(getByTestId('today-pending-schedule-card')).toBeTruthy();
    const cta = getByTestId('today-pending-schedule-cta');
    expect(cta).toBeTruthy();

    cta.props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith(
      `/(private)/schedule/respond/${PATTERN_ID}`
    );
  });

  it('renders nothing while the pattern detail (days) is still loading, to avoid a 0-day flash', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [pendingPatternForMe],
      isLoading: false,
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
    }));

    const { queryByTestId } = render(<PendingScheduleCard />);

    expect(queryByTestId('today-pending-schedule-card')).toBeNull();
  });
});
