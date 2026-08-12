/**
 * @module domains/setup/__tests__/StartScreen.behavior.test
 *
 * The start fork (`screens-onboarding-terms-proposal.md` §3.2) — the screen
 * D-33 is actually asking for. BOTH cards exist for BOTH roles; that symmetry
 * IS D-33. Only the "create" card's description is role-dependent.
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

let StartScreen: typeof import('../components/StartScreen').StartScreen;

beforeAll(async () => {
  ({ StartScreen } = await import('../components/StartScreen'));
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  useSetupProgressStore.getState().reset();
});

describe('StartScreen — both cards for both roles (D-33)', () => {
  it('offers create and join to a parent', () => {
    useSetupProgressStore.getState().setRole('parent');
    const { getByTestId } = render(<StartScreen />);
    expect(getByTestId('start-create')).toBeTruthy();
    expect(getByTestId('start-join')).toBeTruthy();
  });

  it('offers create and join to a nanny', () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    expect(getByTestId('start-create')).toBeTruthy();
    expect(getByTestId('start-join')).toBeTruthy();
  });

  it('parent · create routes to the new HOUSEHOLD step', () => {
    useSetupProgressStore.getState().setRole('parent');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBe('create');
    expect(useSetupProgressStore.getState().currentStep).toBe('HOUSEHOLD');
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/household');
  });

  it('parent · join routes to CODE — a joining parent never reaches children', () => {
    useSetupProgressStore.getState().setRole('parent');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-join'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBe('join');
    expect(useSetupProgressStore.getState().currentStep).toBe('CODE');
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/code');
  });

  it('nanny · create routes to the TERMS step — she authors a draft', () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBe('create');
    expect(useSetupProgressStore.getState().currentStep).toBe('TERMS');
    expect(mockReplace).toHaveBeenCalledWith('/(private)/draft/terms');
  });

  it('nanny · join routes to CODE', () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-join'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBe('join');
    expect(useSetupProgressStore.getState().currentStep).toBe('CODE');
  });

  it('the create description is the only role-dependent string on the screen', () => {
    useSetupProgressStore.getState().setRole('parent');
    const parentScreen = render(<StartScreen />);
    const parentCreate = parentScreen.getByTestId('start-create-description')
      .props.children;
    const parentJoin = parentScreen.getByTestId('start-join-description').props
      .children;
    parentScreen.unmount();

    useSetupProgressStore.getState().setRole('nanny');
    const nannyScreen = render(<StartScreen />);
    const nannyCreate = nannyScreen.getByTestId('start-create-description')
      .props.children;
    const nannyJoin = nannyScreen.getByTestId('start-join-description').props
      .children;

    expect(nannyCreate).not.toBe(parentCreate);
    expect(nannyJoin).toBe(parentJoin);
  });

  it('back returns to the role fork', () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-screen-back'));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/role');
  });

  it('does nothing until a card is picked', () => {
    useSetupProgressStore.getState().setRole('parent');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
