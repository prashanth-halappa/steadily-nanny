/**
 * @module domains/schedule/components/__tests__/NannyUsualWeekScreen.test
 *
 * S11: the nanny's read-only "Your usual week" surface. `useHouseholdById`
 * / `useSchedulePatterns` / `useSchedulePattern` / `useChildren` /
 * `useAuthStore` / `expo-router` are mocked via `mock.module()` in
 * `beforeAll`, before the dynamic import, per docs/09-TESTING.md.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';

let mockUseHouseholdById: ReturnType<typeof mock>;
let mockUseSchedulePatterns: ReturnType<typeof mock>;
let mockUseSchedulePattern: ReturnType<typeof mock>;
let mockPush: ReturnType<typeof mock>;

let NannyUsualWeekScreen: typeof import('../NannyUsualWeekScreen').NannyUsualWeekScreen;

function makePattern(overrides: Partial<SchedulePattern>): SchedulePattern {
  return {
    id: 'p1',
    household_id: HOUSEHOLD_ID,
    carer_id: ME,
    status: 'pending',
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    dtstart: '2026-08-05',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as SchedulePattern;
}

beforeAll(async () => {
  mockUseHouseholdById = mock(() => ({
    household: { id: HOUSEHOLD_ID, name: 'The Smiths', timezone: 'UTC' },
    isLoading: false,
    isError: false,
    notMember: false,
  }));
  mockUseSchedulePatterns = mock(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockUseSchedulePattern = mock(() => ({ data: undefined }));
  mockPush = mock();

  mock.module('@/src/hooks/queries/useHouseholdById', () => ({
    useHouseholdById: () => mockUseHouseholdById(),
  }));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: () => mockUseSchedulePatterns(),
  }));
  mock.module('@/src/hooks/queries/useSchedulePattern', () => ({
    useSchedulePattern: () => mockUseSchedulePattern(),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({ data: [] }),
  }));
  mock.module('@/src/store/auth', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
      selector({ user: { id: ME } }),
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush, back: mock() }),
    useLocalSearchParams: () => ({ householdId: HOUSEHOLD_ID }),
  }));

  const mod = await import('../NannyUsualWeekScreen');
  NannyUsualWeekScreen = mod.NannyUsualWeekScreen;
});

beforeEach(() => {
  mockUseHouseholdById.mockImplementation(() => ({
    household: { id: HOUSEHOLD_ID, name: 'The Smiths', timezone: 'UTC' },
    isLoading: false,
    isError: false,
    notMember: false,
  }));
  mockUseSchedulePatterns.mockImplementation(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: mock(),
  }));
  mockUseSchedulePattern.mockImplementation(() => ({ data: undefined }));
});

describe('NannyUsualWeekScreen', () => {
  it('renders the not-a-member state and never the empty state when the household names her nowhere', () => {
    mockUseHouseholdById.mockImplementation(() => ({
      household: null,
      isLoading: false,
      isError: false,
      notMember: true,
    }));

    const { getByTestId, queryByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-not-member')).toBeTruthy();
    expect(queryByTestId('nanny-usual-week-empty')).toBeNull();
  });

  it('empty state when she has no pattern at all with this family', () => {
    const { getByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-empty')).toBeTruthy();
  });

  it('never shows a DRAFT pattern — nothing was ever sent to her', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [makePattern({ status: 'draft' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    const { getByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-empty')).toBeTruthy();
  });

  it('never shows a pattern addressed to a DIFFERENT carer', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [makePattern({ status: 'accepted', carer_id: 'someone-else' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    const { getByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-empty')).toBeTruthy();
  });

  it('shows her ACCEPTED pattern read-only, with a preview', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [makePattern({ status: 'accepted' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    mockUseSchedulePattern.mockImplementation(() => ({
      data: { ...makePattern({ status: 'accepted' }), days: [] },
    }));
    const { getByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-status')).toBeTruthy();
  });

  it('S9: an ended pattern gets its own neutral copy, not the empty state', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [makePattern({ status: 'ended' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    const { getByTestId, queryByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-ended')).toBeTruthy();
    expect(queryByTestId('nanny-usual-week-empty')).toBeNull();
  });

  it('a withdrawn pattern gets its own neutral copy', () => {
    mockUseSchedulePatterns.mockImplementation(() => ({
      data: [makePattern({ status: 'withdrawn' })],
      isLoading: false,
      isError: false,
      refetch: mock(),
    }));
    const { getByTestId } = render(<NannyUsualWeekScreen />);
    expect(getByTestId('nanny-usual-week-withdrawn')).toBeTruthy();
  });
});
