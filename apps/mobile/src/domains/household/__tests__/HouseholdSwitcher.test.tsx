/**
 * @module domains/household/__tests__/HouseholdSwitcher.test
 * Pattern B (mock rendering, docs/09-TESTING.md §5): the switcher is invisible
 * for one household (or zero/loading), appears for a nanny in multiple
 * households, and picking an option persists the new active household.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useActiveHouseholdStore } from '@/src/store/activeHousehold';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_A = { id: 'household-a', name: 'The Reyes Household' };
const HOUSEHOLD_B = { id: 'household-b', name: 'The Chen Household' };

const HOUSEHOLD_PAST = { id: 'household-past', name: 'The Okonjo Household' };

const householdsListMock = mock(() => Promise.resolve([] as unknown[]));
const householdsListPastMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdsListMock, listPast: householdsListPastMock },
}));

let HouseholdSwitcher: typeof import('../components/HouseholdSwitcher').HouseholdSwitcher;

beforeEach(async () => {
  HouseholdSwitcher = (await import('../components/HouseholdSwitcher'))
    .HouseholdSwitcher;

  householdsListMock.mockReset();
  householdsListMock.mockResolvedValue([]);
  householdsListPastMock.mockReset();
  householdsListPastMock.mockResolvedValue([]);
  useActiveHouseholdStore.getState().reset();
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('HouseholdSwitcher', () => {
  it('renders nothing while households are loading', () => {
    householdsListMock.mockImplementation(() => new Promise(() => {}));

    const { queryByTestId } = renderWithProviders(<HouseholdSwitcher />);

    expect(queryByTestId('household-switcher')).toBeNull();
  });

  it('renders nothing for a single household', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);

    const { queryByTestId } = renderWithProviders(<HouseholdSwitcher />);

    await waitFor(() => expect(householdsListMock).toHaveBeenCalled());
    expect(queryByTestId('household-switcher')).toBeNull();
  });

  it('shows the current household name for a nanny in multiple households', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);

    const { getByTestId } = renderWithProviders(<HouseholdSwitcher />);

    await waitFor(() => expect(getByTestId('household-switcher')).toBeTruthy());
    expect(getByTestId('household-switcher-current-name').props.children).toBe(
      HOUSEHOLD_A.name
    );
  });

  it('tapping an option in the sheet switches the active household', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A, HOUSEHOLD_B]);

    const { getByTestId } = renderWithProviders(<HouseholdSwitcher />);

    await waitFor(() => expect(getByTestId('household-switcher')).toBeTruthy());

    fireEvent.press(getByTestId('household-switcher-trigger'));
    fireEvent.press(getByTestId(`household-switcher-option-${HOUSEHOLD_B.id}`));

    await waitFor(() =>
      expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBe(
        HOUSEHOLD_B.id
      )
    );
    await waitFor(() =>
      expect(
        getByTestId('household-switcher-current-name').props.children
      ).toBe(HOUSEHOLD_B.name)
    );
  });

  // The device pass showed the removed nanny had NO route to the money she
  // was owed: her old household vanished from the picker, so the hours the
  // API still serves her were unreachable.
  it('offers a past household even when only one active household remains', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);

    const { getByTestId } = renderWithProviders(<HouseholdSwitcher />);

    await waitFor(() => expect(getByTestId('household-switcher')).toBeTruthy());

    fireEvent.press(getByTestId('household-switcher-trigger'));
    expect(
      getByTestId(`household-switcher-option-${HOUSEHOLD_PAST.id}`)
    ).toBeTruthy();
    expect(getByTestId('household-switcher-past-section')).toBeTruthy();
  });

  it('marks the trigger as past once a past household is selected', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);

    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdSwitcher />
    );

    await waitFor(() => expect(getByTestId('household-switcher')).toBeTruthy());
    expect(queryByTestId('household-switcher-past-badge')).toBeNull();

    fireEvent.press(getByTestId('household-switcher-trigger'));
    fireEvent.press(
      getByTestId(`household-switcher-option-${HOUSEHOLD_PAST.id}`)
    );

    await waitFor(() =>
      expect(
        getByTestId('household-switcher-current-name').props.children
      ).toBe(HOUSEHOLD_PAST.name)
    );
    expect(getByTestId('household-switcher-past-badge')).toBeTruthy();
  });

  it('still renders nothing for one household and no past ones', async () => {
    householdsListMock.mockResolvedValue([HOUSEHOLD_A]);
    householdsListPastMock.mockResolvedValue([]);

    const { queryByTestId } = renderWithProviders(<HouseholdSwitcher />);

    await waitFor(() => expect(householdsListPastMock).toHaveBeenCalled());
    expect(queryByTestId('household-switcher')).toBeNull();
  });

  // The commonest removal case: she worked for one family and they let her
  // go. There is nothing to switch BETWEEN, but the chip is the only thing on
  // screen that says the household she is reading is history.
  it('renders as a past marker when her one remaining household is a past one', async () => {
    householdsListMock.mockResolvedValue([]);
    householdsListPastMock.mockResolvedValue([HOUSEHOLD_PAST]);

    const { getByTestId } = renderWithProviders(<HouseholdSwitcher />);

    await waitFor(() =>
      expect(getByTestId('household-switcher-past-badge')).toBeTruthy()
    );
    expect(getByTestId('household-switcher-current-name').props.children).toBe(
      HOUSEHOLD_PAST.name
    );
  });
});
