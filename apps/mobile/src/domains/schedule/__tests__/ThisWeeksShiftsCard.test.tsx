/**
 * @module domains/schedule/__tests__/ThisWeeksShiftsCard.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

const HOUSEHOLD_ID = 'hh1';
const AMARA_ID = '33333333-3333-4333-8333-333333333333';
const BEA_ID = '44444444-4444-4444-8444-444444444444';

let ThisWeeksShiftsCard: typeof import('../components/ThisWeeksShiftsCard').ThisWeeksShiftsCard;
let mockPush: ReturnType<typeof mock>;
let mockUseShiftsRange: ReturnType<typeof mock>;
let mockUseHouseholdMembers: ReturnType<typeof mock>;

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

/** Far enough ahead that the card always lists it, whenever the suite runs. */
function shift(id: string, carerId: string, day: string) {
  return {
    id,
    household_id: HOUSEHOLD_ID,
    carer_id: carerId,
    local_date: day,
    status: 'confirmed',
    starts_at: `${day}T09:00:00.000Z`,
    ends_at: `${day}T17:00:00.000Z`,
  };
}

const SHIFTS = [
  shift('shift-a', AMARA_ID, '2099-08-06'),
  shift('shift-b', BEA_ID, '2099-08-07'),
];

beforeAll(async () => {
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: HOUSEHOLD_ID,
      household: { timezone: 'Europe/London' },
    }),
  }));
  mockUseShiftsRange = mock(() => ({ data: [] as unknown[] }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: mockUseShiftsRange,
  }));
  mockUseHouseholdMembers = mock(() => ({ data: [] as unknown[] }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: mockUseHouseholdMembers,
  }));

  const mod = await import('../components/ThisWeeksShiftsCard');
  ThisWeeksShiftsCard = mod.ThisWeeksShiftsCard;
});

beforeEach(() => {
  mockUseShiftsRange.mockReturnValue({ data: [] });
  mockUseHouseholdMembers.mockReturnValue({ data: [] });
});

describe('ThisWeeksShiftsCard', () => {
  it('renders the Next up card', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    expect(getByTestId('today-shifts-card')).toBeTruthy();
  });

  it('navigates to /schedule/shifts from the calendar link', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const cta = getByTestId('today-shifts-cta');
    cta.props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/shifts');
  });

  it('one-carer household: names her once under the title, not on every row', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor')],
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    // Her FULL name, once — repeating it per row is noise in a one-carer home.
    expect(getByTestId('today-next-up-carer').props.children).toBe(
      'Amara Okafor'
    );
    expect(queryByTestId('today-next-up-carer-shift-a')).toBeNull();
  });

  it('two-carer household: each row carries its own carer first name', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });
    mockUseHouseholdMembers.mockReturnValue({
      data: [member(AMARA_ID, 'Amara Okafor'), member(BEA_ID, 'Beatriz Ruiz')],
    });

    const { getByTestId, queryByTestId } = render(<ThisWeeksShiftsCard />);

    expect(queryByTestId('today-next-up-carer')).toBeNull();
    expect(getByTestId('today-next-up-carer-shift-a').props.children).toBe(
      'Amara'
    );
    expect(getByTestId('today-next-up-carer-shift-b').props.children).toBe(
      'Beatriz'
    );
  });

  it('rows meet the 44pt touch target and carry hit slop', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });

    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const row = getByTestId('today-next-up-shift-a');

    expect(row.props.hitSlop).toBe(8);
    expect(row.props.style).toEqual({ minHeight: 44 });
  });

  it('shows the weekday in its short form so the row stays on one line', () => {
    mockUseShiftsRange.mockReturnValue({ data: SHIFTS });

    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const line = getByTestId('today-next-up-line-shift-a').props
      .children as string;

    expect(line).toContain('weekdayShort.');
    expect(line).not.toContain('weekday.');
  });
});
