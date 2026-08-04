/**
 * @module domains/schedule/__tests__/ThisWeeksShiftsCard.test
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';

let ThisWeeksShiftsCard: typeof import('../components/ThisWeeksShiftsCard').ThisWeeksShiftsCard;
let mockPush: ReturnType<typeof mock>;

beforeAll(async () => {
  mockPush = mock();
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
  }));
  mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
    useActiveHousehold: () => ({
      householdId: 'hh1',
      household: { timezone: 'Europe/London' },
    }),
  }));
  mock.module('@/src/hooks/queries/useShiftsRange', () => ({
    useShiftsRange: () => ({ data: [] }),
  }));

  const mod = await import('../components/ThisWeeksShiftsCard');
  ThisWeeksShiftsCard = mod.ThisWeeksShiftsCard;
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
});
