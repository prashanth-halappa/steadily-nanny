/**
 * @module domains/setup/__tests__/AvailabilityScreen.behavior.test
 *
 * Pattern B — render + press. Two wizard-only guarantees:
 * Finish is disabled (with a stated reason) at zero selected days, and
 * "Set this up later" advances to the notifications step WITHOUT writing an
 * availability row. The skip is safe because `useIsOnboarded` derives a
 * nanny's onboarded state from her membership alone — availability rows are
 * not part of the predicate, so skipping cannot strand her in a resume loop.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

const mutateMock = mock((_input: Record<string, unknown>) => undefined);
const pushMock = mock((_href: string) => undefined);
let rows: Array<{ weekday: number; is_available: boolean }> = [];

mock.module('@/src/hooks/queries/useAvailability', () => ({
  useAvailability: () => ({ data: rows, isLoading: false }),
}));

mock.module('@/src/hooks/mutations/useUpsertAvailability', () => ({
  useUpsertAvailability: () => ({ mutate: mutateMock }),
}));

mock.module('@/src/hooks/queries/useUserProfile', () => ({
  useUserProfile: () => ({ data: { week_starts_on: 1 } }),
}));

mock.module('expo-router', () => ({
  useRouter: () => ({ push: pushMock, back: mock(() => undefined) }),
}));

// The real Button is already stubbed to a host 'Button' element by the
// preload; keep the shell itself real so the CTA/skip wiring under test is
// the wiring that ships.
mock.module('@/src/components/ui/switch', () => {
  const React = require('react');
  return {
    Switch: ({ testID }: { testID?: string }) =>
      React.createElement('Pressable', { testID }),
  };
});

let AvailabilityScreen: typeof import('../components/AvailabilityScreen').AvailabilityScreen;

beforeAll(async () => {
  ({ AvailabilityScreen } = await import('../components/AvailabilityScreen'));
});

beforeEach(() => {
  rows = [];
  mutateMock.mockClear();
  pushMock.mockClear();
});

describe('AvailabilityScreen (wizard)', () => {
  it('disables Finish at zero selected days and states why', () => {
    const { getByTestId } = renderWithProviders(<AvailabilityScreen />);

    expect(getByTestId('availability-screen-cta').props.disabled).toBe(true);
    expect(getByTestId('availability-cta-reason')).toBeTruthy();
  });

  it('enables Finish and drops the reason line once a day is on', () => {
    rows = [{ weekday: 1, is_available: true }];
    const { getByTestId, queryByTestId } = renderWithProviders(
      <AvailabilityScreen />
    );

    expect(getByTestId('availability-screen-cta').props.disabled).toBe(false);
    expect(queryByTestId('availability-cta-reason')).toBeNull();
  });

  it('advances on skip without writing any availability row', () => {
    const { getByTestId } = renderWithProviders(<AvailabilityScreen />);

    expect(getByTestId('availability-skip-reassurance')).toBeTruthy();
    fireEvent.press(getByTestId('availability-screen-skip'));

    expect(mutateMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/onboarding/notifications');
  });
});
