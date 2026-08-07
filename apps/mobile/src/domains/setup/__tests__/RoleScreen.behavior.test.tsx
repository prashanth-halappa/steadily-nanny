/**
 * @module domains/setup/__tests__/RoleScreen.behavior.test
 *
 * W1-E fix 1 — a co-parent invited to an EXISTING household had no honest
 * path on this screen: picking "I'm a parent" creates a brand-new
 * household, and the only way to actually redeem an invite was to falsely
 * pick "I'm a nanny". Locks in the third "I have an invite code" card:
 * renders alongside the other two, has its own independent highlight state,
 * and — selected + Continue — routes into the SAME CODE step the nanny card
 * uses (the server resolves the real membership role at redeem; see
 * CodeEntryScreen's header comment).
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
  useSetupProgressStore.setState({
    role: null,
    currentStep: 'ROLE',
    householdId: null,
  });
});

describe('RoleScreen — invite-code card (W1-E fix 1)', () => {
  it('renders three role cards', () => {
    const { getByTestId } = render(<RoleScreen />);
    expect(getByTestId('role-parent')).toBeTruthy();
    expect(getByTestId('role-nanny')).toBeTruthy();
    expect(getByTestId('role-invite-code')).toBeTruthy();
  });

  it('selecting the invite-code card highlights only that card, not the nanny card', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-invite-code'));

    expect(getByTestId('role-invite-code').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId('role-nanny').props.accessibilityState).toEqual({
      selected: false,
    });
    expect(getByTestId('role-parent').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('selecting the invite-code card and continuing routes to the CODE step, same as the nanny card', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-invite-code'));
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/code');
    expect(useSetupProgressStore.getState().role).toBe('nanny');
    expect(useSetupProgressStore.getState().currentStep).toBe('CODE');
  });

  it('still routes a plain nanny selection to CODE (unchanged)', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-nanny'));
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/code');
    expect(useSetupProgressStore.getState().role).toBe('nanny');
  });

  it('still routes a parent selection to CHILDREN (unchanged)', () => {
    const { getByTestId } = render(<RoleScreen />);
    fireEvent.press(getByTestId('role-parent'));
    fireEvent.press(getByTestId('role-screen-cta'));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/children');
    expect(useSetupProgressStore.getState().role).toBe('parent');
  });
});
