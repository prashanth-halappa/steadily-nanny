/**
 * @module domains/setup/__tests__/ManageHouseholdScreen.memberNames.test
 *
 * Household settings rendered TWO identical "Finish setting up Nanny" cards
 * for two different nannies: the screen read only `display_name_override`
 * (null for both) and fell back to the role label.
 *
 * `PaySetupPromptCard` is stubbed here to surface its `carerName` as text —
 * the real card feeds the name through `t('promptCard.title', { name })`, and
 * the global i18n mock echoes keys and drops interpolation values, so the
 * name would be invisible to any assertion. The sibling
 * `ManageHouseholdScreen.test.tsx` keeps rendering the real card.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor, within } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let ManageHouseholdScreen: typeof import('../components/ManageHouseholdScreen').ManageHouseholdScreen;

const HOUSEHOLD_ID = 'household-1';
const PARENT_USER_ID = 'parent-1';
const now = '2026-08-01T10:00:00.000Z';

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});
mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('View', null, children);
  return {
    Root: passthrough,
    Trigger: passthrough,
    Portal: passthrough,
    Overlay: passthrough,
    Content: passthrough,
    Title: passthrough,
    Description: passthrough,
    Action: passthrough,
    Cancel: passthrough,
    useRootContext: () => ({ open: false, onOpenChange: () => {} }),
  };
});
mock.module('@/src/domains/pay/components/PaySetupPromptCard', () => {
  const React = require('react');
  return {
    PaySetupPromptCard: ({
      carerId,
      carerName,
    }: {
      carerId: string;
      carerName: string;
    }) =>
      React.createElement(
        'View',
        { testID: `pay-setup-prompt-${carerId}` },
        React.createElement('Text', null, carerName)
      ),
  };
});

const baseHousehold = {
  id: HOUSEHOLD_ID,
  name: 'The Smiths',
  created_by: PARENT_USER_ID,
  address_line: null,
  timezone: 'Europe/London',
  currency: 'GBP',
  approval_mode: 'either',
  approval_scope: 'all',
  created_at: now,
  updated_at: now,
};

const nanny = (id: string, profileName: string | null) => ({
  id: `member-${id}`,
  household_id: HOUSEHOLD_ID,
  user_id: id,
  role: 'nanny',
  can_edit: false,
  status: 'active',
  display_name_override: null,
  profile_name: profileName,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
});

const listMock = mock(() => Promise.resolve([baseHousehold]));
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const membershipsListMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([
    {
      id: 'member-owner',
      household_id: HOUSEHOLD_ID,
      user_id: PARENT_USER_ID,
      role: 'owner',
      can_edit: true,
      status: 'active',
      display_name_override: null,
      colour: null,
      joined_at: now,
      created_at: now,
      updated_at: now,
    },
  ])
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listMock,
    update: mock(),
    listMembers: listMembersMock,
  },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: {
    list: mock(() => Promise.resolve([{ id: 'child-1', name: 'Ada', age: 4 }])),
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));

beforeAll(async () => {
  ManageHouseholdScreen = (await import('../components/ManageHouseholdScreen'))
    .ManageHouseholdScreen;
});

beforeEach(() => {
  listMembersMock.mockReset();
  listMembersMock.mockImplementation(() => Promise.resolve([]));
  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ManageHouseholdScreen — member names', () => {
  it('tells two un-overridden nannies apart by their profile names', async () => {
    listMembersMock.mockImplementation(() =>
      Promise.resolve([nanny('nanny-a', 'Amara'), nanny('nanny-b', 'Bea')])
    );

    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() => expect(getByTestId('pay-setup-prompt-nanny-a')));
    // Scoped to the prompt card: the same name now ALSO appears in the D3
    // members list this screen renders, so an unscoped `getByText` matches
    // both and throws "multiple elements found".
    expect(
      within(getByTestId('pay-setup-prompt-nanny-a')).getByText('Amara')
    ).toBeTruthy();
    expect(
      within(getByTestId('pay-setup-prompt-nanny-b')).getByText('Bea')
    ).toBeTruthy();
  });

  it('still falls back to the role label when there is no name at all', async () => {
    listMembersMock.mockImplementation(() =>
      Promise.resolve([nanny('nanny-c', null)])
    );

    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() =>
      expect(
        within(getByTestId('pay-setup-prompt-nanny-c')).getByText('role.nanny')
      ).toBeTruthy()
    );
  });

  it('keeps the household override ahead of the profile name', async () => {
    listMembersMock.mockImplementation(() =>
      Promise.resolve([
        { ...nanny('nanny-d', 'Beatriz'), display_name_override: 'Bea' },
      ])
    );

    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() =>
      expect(
        within(getByTestId('pay-setup-prompt-nanny-d')).getByText('Bea')
      ).toBeTruthy()
    );
  });
});
