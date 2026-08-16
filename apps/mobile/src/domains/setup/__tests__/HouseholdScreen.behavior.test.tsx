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

const listMembersMock = mock((): Promise<unknown[]> => Promise.resolve([]));
const updateHouseholdMock = mock(
  (_householdId: string, _input: { name?: string }) =>
    Promise.resolve({ id: 'household-9', name: 'The Ahmeds' })
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listHouseholdsMock,
    create: createHouseholdMock,
    listMembers: listMembersMock,
    update: updateHouseholdMock,
  },
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
  listMembersMock.mockClear();
  updateHouseholdMock.mockClear();
  listMembersMock.mockImplementation(() => Promise.resolve([]));
  updateHouseholdMock.mockImplementation(() =>
    Promise.resolve({ id: 'household-9', name: 'The Ahmeds (renamed)' })
  );
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

// §8a (direction workstream 8 / plan §S6) — a parent who already owns a
// LIVE household must RENAME it here, never mint a second one. CTA reads
// "Save", not "Continue"/"Create"; the hint names the nanny who sees it.
describe('HouseholdScreen — rename mode for an existing LIVE household (§8a)', () => {
  it('shows "Save" as the CTA and prefills the current name', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        { id: 'household-9', name: 'The Ahmeds', state: 'live' },
      ])
    );
    const screen = renderWithProviders(<HouseholdScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('household-name-input').props.value).toBe(
        'The Ahmeds'
      )
    );
    expect(screen.getByText('setup.saveButton')).toBeTruthy();
  });

  it('shows the hint naming the first active nanny on the household', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        { id: 'household-9', name: 'The Ahmeds', state: 'live' },
      ])
    );
    listMembersMock.mockImplementation(() =>
      Promise.resolve([
        {
          id: 'member-1',
          household_id: 'household-9',
          role: 'nanny',
          status: 'active',
          profile_name: 'Marisol',
        },
      ])
    );
    const screen = renderWithProviders(<HouseholdScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('household-name-hint')).toBeTruthy()
    );
  });

  it('omits the hint entirely when there is no active nanny yet', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        { id: 'household-9', name: 'The Ahmeds', state: 'live' },
      ])
    );
    listMembersMock.mockImplementation(() => Promise.resolve([]));
    const screen = renderWithProviders(<HouseholdScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('household-name-input')).toBeTruthy()
    );
    expect(screen.queryByTestId('household-name-hint')).toBeNull();
  });

  it('PATCHes only the name when it changed, then advances — never creates', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        { id: 'household-9', name: 'The Ahmeds', state: 'live' },
      ])
    );
    const screen = renderWithProviders(<HouseholdScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('household-name-input').props.value).toBe(
        'The Ahmeds'
      )
    );
    fireEvent.changeText(
      screen.getByTestId('household-name-input'),
      'The Ahmed Family'
    );
    fireEvent.press(screen.getByTestId('household-screen-cta'));

    await waitFor(() => expect(updateHouseholdMock).toHaveBeenCalledTimes(1));
    expect(updateHouseholdMock).toHaveBeenCalledWith('household-9', {
      name: 'The Ahmed Family',
    });
    expect(createHouseholdMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(useSetupProgressStore.getState().householdId).toBe('household-9')
    );
    expect(mockPush).toHaveBeenCalledWith('/onboarding/children');
  });

  it('does not PATCH when the name is unchanged', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        { id: 'household-9', name: 'The Ahmeds', state: 'live' },
      ])
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
    expect(updateHouseholdMock).not.toHaveBeenCalled();
    expect(createHouseholdMock).not.toHaveBeenCalled();
  });
});
