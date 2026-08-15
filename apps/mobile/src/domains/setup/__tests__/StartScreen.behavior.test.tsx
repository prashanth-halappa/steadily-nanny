/**
 * @module domains/setup/__tests__/StartScreen.behavior.test
 *
 * The start fork (`screens-onboarding-terms-proposal.md` §3.2) — the screen
 * D-33 is actually asking for. BOTH cards exist for BOTH roles; that symmetry
 * IS D-33. Only the "create" card's description is role-dependent.
 *
 * B0: nanny · create must mint a draft household here so DraftTermsScreen's
 * Save CTA (`canSave = Boolean(request) && !!householdId`) is reachable.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CreateHouseholdInput } from '@steadily-nanny/shared-types/schemas/household.schema';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

const mutateAsyncMock = mock(
  (_input: CreateHouseholdInput): Promise<{ id: string }> =>
    Promise.resolve({ id: 'household-draft-1' })
);
mock.module('@/src/hooks/mutations/useCreateHousehold', () => ({
  useCreateHousehold: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));

mock.module('@/src/lib/deviceTimeZone', () => ({
  getDeviceTimeZone: () => 'America/Los_Angeles',
}));
mock.module('@/src/lib/deviceLocale', () => ({
  getDeviceCurrency: () => 'USD',
  getDeviceLocale: () => 'en-US',
  getDeviceRegion: () => 'US',
}));

let StartScreen: typeof import('../components/StartScreen').StartScreen;

beforeAll(async () => {
  ({ StartScreen } = await import('../components/StartScreen'));
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mutateAsyncMock.mockClear();
  mutateAsyncMock.mockImplementation((_input: CreateHouseholdInput) =>
    Promise.resolve({ id: 'household-draft-1' })
  );
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

  it('nanny · create routes to the TERMS step — she authors a draft', async () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().path).toBe('create');
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe('TERMS')
    );
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

describe('StartScreen — nanny · create mints a draft household (B0)', () => {
  it('nanny · create calls mutateAsync once with state draft, timezone, currency, and no name', async () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    const arg = mutateAsyncMock.mock.calls[0]?.[0];
    expect(arg).toEqual({
      state: 'draft',
      timezone: 'America/Los_Angeles',
      currency: 'USD',
    });
    expect(arg).not.toHaveProperty('name');
  });

  it('nanny · create navigates to TERMS only after the mutation resolves', async () => {
    let resolveMutation!: (value: { id: string }) => void;
    mutateAsyncMock.mockImplementation(
      () =>
        new Promise<{ id: string }>(resolve => {
          resolveMutation = resolve;
        })
    );

    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useSetupProgressStore.getState().currentStep).not.toBe('TERMS');

    resolveMutation({ id: 'household-draft-1' });

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/(private)/draft/terms')
    );
    expect(useSetupProgressStore.getState().currentStep).toBe('TERMS');
  });

  it('parent · create does not call mutateAsync — HouseholdScreen owns that create', async () => {
    useSetupProgressStore.getState().setRole('parent');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().currentStep).toBe('HOUSEHOLD');
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/household');
    // Give any accidental async create a tick to fire before asserting absence.
    await Promise.resolve();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('nanny · join does not call mutateAsync', async () => {
    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-join'));
    fireEvent.press(getByTestId('start-screen-cta'));

    expect(useSetupProgressStore.getState().currentStep).toBe('CODE');
    await Promise.resolve();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('mutation rejection leaves the user on the start screen — staying put is the retry', async () => {
    mutateAsyncMock.mockImplementation(() =>
      Promise.reject(new Error('network down'))
    );

    useSetupProgressStore.getState().setRole('nanny');
    const { getByTestId } = render(<StartScreen />);
    fireEvent.press(getByTestId('start-create'));
    fireEvent.press(getByTestId('start-screen-cta'));

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1));
    // One more tick so a buggy eager navigation would have fired.
    await Promise.resolve();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useSetupProgressStore.getState().currentStep).not.toBe('TERMS');
  });
});
