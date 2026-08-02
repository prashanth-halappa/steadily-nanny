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

const householdsListMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdsListMock },
}));

let HouseholdSwitcher: typeof import('../components/HouseholdSwitcher').HouseholdSwitcher;

beforeEach(async () => {
  HouseholdSwitcher = (await import('../components/HouseholdSwitcher'))
    .HouseholdSwitcher;

  householdsListMock.mockReset();
  householdsListMock.mockResolvedValue([]);
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
});
