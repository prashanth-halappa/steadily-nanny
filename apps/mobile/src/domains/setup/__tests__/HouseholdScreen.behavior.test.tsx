/**
 * @module domains/setup/__tests__/HouseholdScreen.behavior.test
 *
 * The new HOUSEHOLD step (spec §3.3). Until now the household-name and
 * parent-name inputs only existed inside `ChildrenScreen`'s
 * `isLoadingHousehold` window — visible ONLY while the auto-create call was in
 * flight, which is a race, not a screen. This step gives them a screen of
 * their own and makes the create an explicit act.
 *
 * `ChildrenScreen` keeps its auto-create effect as the fallback for a
 * returning parent who signs out mid-wizard; this is a move, not a build.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CreateHouseholdInput } from '@steadily-nanny/shared-types/schemas/household.schema';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';

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

const listHouseholdsMock = mock((): Promise<unknown[]> => Promise.resolve([]));
const createHouseholdMock = mock(
  (_req: CreateHouseholdInput): Promise<{ id: string; name: string }> =>
    Promise.resolve({ id: 'household-1', name: 'The Ruiz Family' })
);
const getProfileMock = mock(
  (): Promise<unknown> => Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);
const upsertProfileMock = mock(
  (_req: { name: string }): Promise<{ user_id: string; name: string }> =>
    Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listHouseholdsMock, create: createHouseholdMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { getProfile: getProfileMock, upsertProfile: upsertProfileMock },
}));
mock.module('@/src/lib/toast', () => ({ showErrorToast: mock(() => {}) }));

let HouseholdScreen: typeof import('../components/HouseholdScreen').HouseholdScreen;

beforeAll(async () => {
  ({ HouseholdScreen } = await import('../components/HouseholdScreen'));
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  listHouseholdsMock.mockClear();
  createHouseholdMock.mockClear();
  getProfileMock.mockClear();
  upsertProfileMock.mockClear();
  listHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  getProfileMock.mockImplementation(() =>
    Promise.resolve({ user_id: 'user-1', name: 'Ana' })
  );
  useSetupProgressStore.getState().reset();
  useSetupProgressStore.setState({ role: 'parent', path: 'create' } as never);
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} },
    } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('HouseholdScreen — a screen of its own for the two names', () => {
  it('renders both inputs unconditionally, not only while a create is in flight', async () => {
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('household-name-input')).toBeTruthy()
    );
    expect(screen.getByTestId('parent-name-input')).toBeTruthy();
  });

  it('pre-fills the parent name from auth metadata', async () => {
    getProfileMock.mockImplementation(() => Promise.resolve(undefined));
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('parent-name-input').props.value).toBe('ana')
    );
  });

  it('does not create anything until Continue is pressed', async () => {
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('household-name-input')).toBeTruthy()
    );
    fireEvent.changeText(
      screen.getByTestId('household-name-input'),
      'The Ruiz Family'
    );
    expect(createHouseholdMock).not.toHaveBeenCalled();
  });

  it('creates the household with the typed name on Continue, then advances to CHILDREN', async () => {
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('household-name-input')).toBeTruthy()
    );

    fireEvent.changeText(
      screen.getByTestId('household-name-input'),
      'The Ruiz Family'
    );
    fireEvent.press(screen.getByTestId('household-screen-cta'));

    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalledTimes(1));
    expect(createHouseholdMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'The Ruiz Family',
    });
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe('CHILDREN')
    );
    expect(mockPush).toHaveBeenCalledWith('/onboarding/children');
  });

  it('submits the edited display name with the bootstrap profile upsert', async () => {
    getProfileMock.mockImplementation(() => Promise.resolve(undefined));
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('parent-name-input')).toBeTruthy()
    );

    fireEvent.changeText(screen.getByTestId('parent-name-input'), 'Maria Ruiz');
    fireEvent.changeText(screen.getByTestId('household-name-input'), 'Ruiz');
    fireEvent.press(screen.getByTestId('household-screen-cta'));

    await waitFor(() => expect(upsertProfileMock).toHaveBeenCalledTimes(1));
    expect(upsertProfileMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'Maria Ruiz',
    });
  });

  it('Continue does nothing until a household name is typed — a live household always has one', async () => {
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('household-name-input')).toBeTruthy()
    );

    fireEvent.press(screen.getByTestId('household-screen-cta'));
    fireEvent.changeText(screen.getByTestId('household-name-input'), '   ');
    fireEvent.press(screen.getByTestId('household-screen-cta'));
    expect(createHouseholdMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('household-name-input'), 'Ruiz');
    fireEvent.press(screen.getByTestId('household-screen-cta'));
    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalledTimes(1));
  });

  it('adopts an existing household instead of creating a second one', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([{ id: 'household-9', name: 'The Ahmeds' }])
    );
    const screen = renderWithProviders(<HouseholdScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('household-name-input').props.value).toBe(
        'The Ahmeds'
      )
    );

    fireEvent.press(screen.getByTestId('household-screen-cta'));

    await waitFor(() =>
      expect(useSetupProgressStore.getState().householdId).toBe('household-9')
    );
    expect(createHouseholdMock).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/onboarding/children');
  });

  it('back returns to the start fork', async () => {
    const screen = renderWithProviders(<HouseholdScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('household-screen-back')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('household-screen-back'));
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/start');
  });
});
