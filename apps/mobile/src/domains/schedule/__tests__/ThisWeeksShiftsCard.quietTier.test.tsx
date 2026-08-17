/**
 * @module domains/schedule/__tests__/ThisWeeksShiftsCard.quietTier.test
 *
 * The L4 "Next up" block is the permanent quiet tier for both personas: it
 * is what still tells the truth once the dismissible Today card is gone.
 * "No upcoming shifts in the next two weeks" is true but says nothing about
 * WHY, so an empty fortnight caused by nobody ever sending a weekly schedule
 * reads identical to a quiet fortnight on a settled one.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = 'hh1';
const AMARA_ID = '33333333-3333-4333-8333-333333333333';

let ThisWeeksShiftsCard: typeof import('../components/ThisWeeksShiftsCard').ThisWeeksShiftsCard;
let mockPush: ReturnType<typeof mock>;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;
let mockUseSchedulePatterns: ReturnType<typeof mock>;
let mockUseIsOnboarded: ReturnType<typeof mock>;

function member(userId: string, profileName: string) {
  return {
    id: `member-${userId}`,
    household_id: HOUSEHOLD_ID,
    user_id: userId,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    profile_name: profileName,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function pattern(status: string) {
  return {
    id: `pattern-${status}`,
    household_id: HOUSEHOLD_ID,
    carer_id: AMARA_ID,
    status,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeAll(async () => {
  mockPush = mock();
  mockUseShiftsRange = mock(() => ({ data: [], isLoading: false }));
  mockUseHouseholdMembers = mock(() => ({ data: [member(AMARA_ID, 'Amara')] }));
  mockUseSchedulePatterns = mock(() => ({ data: [], isLoading: false }));
  mockUseIsOnboarded = mock(() => ({ role: 'parent' }));

  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
    router: { push: mockPush },
    Link: ({ children }: { children: unknown }) => children,
  }));
  // The global key-echo mock drops interpolation vars; the quiet lines carry
  // a name, so re-mock with minimal interpolation as the sibling suite does.
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) =>
        vars && Object.keys(vars).length > 0
          ? `${key}(${Object.values(vars).join(',')})`
          : key,
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: (...a: unknown[]) => mockUseShiftsRange(...a),
    isShiftsRouteUnavailable: () => false,
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: (...a: unknown[]) => mockUseHouseholdMembers(...a),
  }));
  mock.module('@/src/hooks/queries/useSchedulePatterns', () => ({
    useSchedulePatterns: (...a: unknown[]) => mockUseSchedulePatterns(...a),
  }));
  mock.module('@/src/hooks/queries/useIsOnboarded', () => ({
    useIsOnboarded: (...a: unknown[]) => mockUseIsOnboarded(...a),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: HOUSEHOLD_ID,
      household: {
        id: HOUSEHOLD_ID,
        name: 'the Ahmeds',
        timezone: 'UTC',
        week_starts_on: 1,
      },
      households: [],
      isLoading: false,
    }),
  }));

  const mod = await import('../components/ThisWeeksShiftsCard');
  ThisWeeksShiftsCard = mod.ThisWeeksShiftsCard;
});

beforeEach(() => {
  mockPush.mockClear();
  mockUseShiftsRange.mockReturnValue({ data: [], isLoading: false });
  mockUseSchedulePatterns.mockReturnValue({ data: [], isLoading: false });
  mockUseIsOnboarded.mockReturnValue({ role: 'parent' });
});

describe('ThisWeeksShiftsCard quiet tier', () => {
  it('tells a parent WHY the fortnight is empty when no schedule was ever sent', () => {
    const { getByText } = render(<ThisWeeksShiftsCard />);
    expect(getByText('todayCard.nextUpEmptyNoWeek(Amara)')).toBeTruthy();
  });

  it('sends that parent to the builder, not the calendar', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    getByTestId('today-shifts-cta').props.onPress();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/build');
  });

  it('names the family for a nanny rather than her carer', () => {
    mockUseIsOnboarded.mockReturnValue({ role: 'nanny' });
    const { getByText } = render(<ThisWeeksShiftsCard />);
    expect(
      getByText('todayCard.nextUpEmptyNoWeekNanny(the Ahmeds)')
    ).toBeTruthy();
  });

  it('stays the plain line on an accepted schedule — a quiet fortnight is not a missing one', () => {
    mockUseSchedulePatterns.mockReturnValue({
      data: [pattern('accepted')],
      isLoading: false,
    });
    const { getByText } = render(<ThisWeeksShiftsCard />);
    expect(getByText('todayCard.nextUpEmpty')).toBeTruthy();
  });

  it('stays the plain line while a schedule is out for a reply', () => {
    mockUseSchedulePatterns.mockReturnValue({
      data: [pattern('pending')],
      isLoading: false,
    });
    const { getByText } = render(<ThisWeeksShiftsCard />);
    expect(getByText('todayCard.nextUpEmpty')).toBeTruthy();
  });
});
