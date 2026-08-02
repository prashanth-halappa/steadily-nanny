/**
 * @module domains/schedule/__tests__/ThisWeeksShiftsCard.test
 *
 * Covers `ThisWeeksShiftsCard` — a small, always-visible entry point (both
 * roles) to `/schedule/shifts`. Unlike `PendingScheduleCard`, this one has
 * no conditional data dependency: it's a static navigation shortcut, so it
 * always renders.
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

  const mod = await import('../components/ThisWeeksShiftsCard');
  ThisWeeksShiftsCard = mod.ThisWeeksShiftsCard;
});

describe('ThisWeeksShiftsCard', () => {
  it('always renders (no data dependency)', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    expect(getByTestId('today-shifts-card')).toBeTruthy();
  });

  it('navigates to /schedule/shifts on tap', () => {
    const { getByTestId } = render(<ThisWeeksShiftsCard />);
    const cta = getByTestId('today-shifts-cta');
    cta.props.onPress?.();
    expect(mockPush).toHaveBeenCalledWith('/(private)/schedule/shifts');
  });
});
