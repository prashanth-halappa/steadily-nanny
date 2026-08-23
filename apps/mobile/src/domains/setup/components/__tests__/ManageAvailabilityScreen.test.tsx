/**
 * @module domains/setup/components/__tests__/ManageAvailabilityScreen.test
 *
 * The write this screen offers (`PUT /v1/availability/me`) is USER-scoped, so
 * the server accepts it from a nanny no family employs any more — it is not a
 * refused write that surfaces an error, it is a real row nobody will ever
 * read. The gate has to be client-side, and it has to ask the right question:
 * "do I work for anyone at all", not "am I a past member of the household the
 * switcher happens to have resolved".
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import { setupNavigationMock } from '@/src/test-utils/mocks/navigation';

setupNavigationMock();

const NANNY_ID = 'nanny-1';

let membershipRows: HouseholdMember[] = [];
const listMembershipsMock = mock(() => Promise.resolve(membershipRows));

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: listMembershipsMock },
}));

// The editor itself is not under test — it pulls the availability query, the
// profile query and a time picker in with it. What matters here is whether it
// is on screen at all.
mock.module('@/src/domains/setup/components/AvailabilityEditor', () => ({
  AvailabilityEditor: () => <View testID="availability-editor" />,
}));

const row = (
  household_id: string,
  status: HouseholdMember['status']
): HouseholdMember =>
  ({ household_id, user_id: NANNY_ID, status }) as HouseholdMember;

let ManageAvailabilityScreen: typeof import('../ManageAvailabilityScreen').ManageAvailabilityScreen;

beforeEach(async () => {
  ({ ManageAvailabilityScreen } = await import('../ManageAvailabilityScreen'));
  listMembershipsMock.mockClear();
  membershipRows = [];
  // BOTH `session` and `user`: the query is enabled off `session`, the viewer
  // lookup reads `user`. A suite that sets only one of them hangs.
  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    isInitialized: true,
    user: { id: NANNY_ID } as unknown as never,
  } as never);
});

describe('ManageAvailabilityScreen', () => {
  it('refuses to offer the editor when no household employs her any more', async () => {
    membershipRows = [row('household-a', 'removed')];

    const { queryByTestId, getByTestId } = renderWithProviders(
      <ManageAvailabilityScreen />
    );

    await waitFor(() =>
      expect(getByTestId('manage-availability-read-only')).toBeTruthy()
    );
    expect(queryByTestId('availability-editor')).toBeNull();
  });

  it('still offers the editor to a nanny with one past AND one active family', async () => {
    membershipRows = [
      row('household-a', 'removed'),
      row('household-b', 'active'),
    ];

    const { queryByTestId, getByTestId } = renderWithProviders(
      <ManageAvailabilityScreen />
    );

    await waitFor(() =>
      expect(getByTestId('availability-editor')).toBeTruthy()
    );
    expect(queryByTestId('manage-availability-read-only')).toBeNull();
  });

  it('offers the editor to an ordinary active nanny', async () => {
    membershipRows = [row('household-a', 'active')];

    const { getByTestId } = renderWithProviders(<ManageAvailabilityScreen />);

    await waitFor(() =>
      expect(getByTestId('availability-editor')).toBeTruthy()
    );
  });

  it('shows neither the editor nor the refusal until memberships resolve', () => {
    membershipRows = [row('household-a', 'active')];

    const { queryByTestId } = renderWithProviders(<ManageAvailabilityScreen />);

    // Unknown fails toward WAIT: no editor to write through, and no claim
    // that she has been let go either.
    expect(queryByTestId('availability-editor')).toBeNull();
    expect(queryByTestId('manage-availability-read-only')).toBeNull();
  });
});
