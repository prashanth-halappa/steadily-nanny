/**
 * @module domains/setup/__tests__/RoleScreen.behavior.test
 *
 * D-33 (`screens-onboarding-terms-proposal.md` §3.1): this screen asks ONE
 * question. The old third card, "I have an invite code", was a PATH wearing a
 * role's clothes — it needed a local `RoleCardSelection` union just to hold a
 * highlight, and it persisted `SETUP_ROLES.NANNY` for a co-parent as pure
 * wiring convenience, which made every joining co-parent a "nanny" to the
 * local wizard until CodeEntryScreen corrected it from the redeemed
 * membership. It is gone; the path is asked on `/onboarding/start` instead,
 * for BOTH roles.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const mockPush = mock();
const mockReplace = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mock(),
    navigate: mock(),
  }),
}));

let RoleScreen: typeof import('../components/RoleScreen').RoleScreen;

beforeAll(async () => {
  ({ RoleScreen } = await import('../components/RoleScreen'));
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  useSetupProgressStore.getState().reset();
});

describe('RoleScreen — the role fork asks exactly one question (D-33)', () => {
  it('renders two role cards and no invite-code card', () => {
    const { getByTestId, queryByTestId } = render(<RoleScreen />);
    expect(getByTestId('role-parent')).toBeTruthy();
    expect(getByTestId('role-nanny')).toBeTruthy();
    expect(queryByTestId('role-invite-code')).toBeNull();
  });

  it('selecting one card deselects the other', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-nanny'));

    expect(getByTestId('role-nanny').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId('role-parent').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('a parent continues to the START fork, not straight to children', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-parent'));
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/start');
    expect(useSetupProgressStore.getState().role).toBe('parent');
    expect(useSetupProgressStore.getState().currentStep).toBe('START');
  });

  it('a nanny continues to the START fork, not straight to the code step', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-nanny'));
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/start');
    expect(useSetupProgressStore.getState().role).toBe('nanny');
    expect(useSetupProgressStore.getState().currentStep).toBe('START');
  });

  it('leaves `path` untouched — the start fork owns it, and _layout reads `role` alone as wizardEngaged', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-nanny'));
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBeNull();
  });

  it('does nothing until a card is picked', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(useSetupProgressStore.getState().role).toBeNull();
  });
});
