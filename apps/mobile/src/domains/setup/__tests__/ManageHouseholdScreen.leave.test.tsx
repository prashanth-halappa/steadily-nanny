/**
 * @module domains/setup/__tests__/ManageHouseholdScreen.leave.test
 *
 * "Leave household" — the member's own way out, the counterpart to the D3
 * per-row Remove (which is somebody else removing you). Two rules matter and
 * both are pinned here: the OWNER never sees it (their membership is created
 * with the household and can never be revoked, so offering it would only
 * produce a 403), and leaving is behind a confirm that says plainly what is
 * lost.
 *
 * The AlertDialog primitive is mocked to actually honour `open` — a
 * passthrough stub would render the confirm at all times and make "the
 * confirm appears only after tapping" untestable.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = 'household-1';
const VIEWER_ID = 'viewer-1';
const now = '2026-08-01T10:00:00.000Z';

mock.module('@/src/components/ui/loading-indicator', () => {
  const R = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      R.createElement('View', {
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
mock.module('@/src/domains/pay/components/PaySetupPromptCard', () => {
  const R = require('react');
  return { PaySetupPromptCard: () => R.createElement('View', null) };
});

mock.module('@rn-primitives/alert-dialog', () => {
  const R = require('react');
  const Ctx = R.createContext({ open: false, setOpen: (_o: boolean) => {} });
  type Kids = { children?: React.ReactNode; [k: string]: unknown };
  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: Kids & { open?: boolean; onOpenChange?: (o: boolean) => void }) =>
      R.createElement(
        Ctx.Provider,
        {
          value: {
            open: open ?? false,
            setOpen: (n: boolean) => onOpenChange?.(n),
          },
        },
        children
      ),
    Trigger: ({ children }: Kids) => children,
    Portal: ({ children }: Kids) => children,
    Overlay: ({ children, ...props }: Kids) => {
      const { open } = R.useContext(Ctx);
      return open ? R.createElement('View', props, children) : null;
    },
    Content: ({ children, ...props }: Kids) => {
      const { open } = R.useContext(Ctx);
      return open ? R.createElement('View', props, children) : null;
    },
    Title: ({ children, ...props }: Kids) =>
      R.createElement('Text', props, children),
    Description: ({ children, ...props }: Kids) =>
      R.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: Kids & { onPress?: (e: unknown) => void }) => {
      const { setOpen } = R.useContext(Ctx);
      return R.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      ...props
    }: Kids & { onPress?: (e: unknown) => void }) => {
      const { setOpen } = R.useContext(Ctx);
      return R.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => R.useContext(Ctx),
  };
});

const replaceMock = mock((_href: string) => {});
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    back: mock(),
    replace: replaceMock,
    navigate: mock(),
  }),
  useLocalSearchParams: () => ({}),
}));

const household = {
  id: HOUSEHOLD_ID,
  name: 'The Smiths',
  created_by: 'owner-1',
  address_line: null,
  timezone: 'Europe/London',
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  approval_timeout_minutes: 60,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_at: now,
  updated_at: now,
};

const member = (
  userId: string,
  role: 'owner' | 'parent' | 'nanny' | 'helper'
) => ({
  id: `member-${userId}`,
  household_id: HOUSEHOLD_ID,
  user_id: userId,
  role,
  can_edit: role !== 'nanny',
  status: 'active',
  display_name_override: null,
  profile_name: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
});

const listMock = mock(() => Promise.resolve([household]));
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const membershipsListMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const leaveMock = mock((_id: string) => Promise.resolve(undefined));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listMock,
    listPast: mock(() => Promise.resolve([])),
    update: mock(),
    updateMember: mock(),
    listMembers: listMembersMock,
    leave: leaveMock,
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

const showErrorToastMock = mock((_m: string) => {});
const showSuccessToastMock = mock((_m: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));

let ManageHouseholdScreen: typeof import('../components/ManageHouseholdScreen').ManageHouseholdScreen;

beforeAll(async () => {
  ManageHouseholdScreen = (await import('../components/ManageHouseholdScreen'))
    .ManageHouseholdScreen;
});

function setViewerRole(role: 'owner' | 'parent') {
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([member(VIEWER_ID, role)])
  );
  listMembersMock.mockImplementation(() =>
    Promise.resolve([member('owner-1', 'owner'), member(VIEWER_ID, role)])
  );
}

beforeEach(() => {
  listMembersMock.mockReset();
  membershipsListMock.mockReset();
  leaveMock.mockReset();
  replaceMock.mockReset();
  showErrorToastMock.mockClear();
  showSuccessToastMock.mockClear();
  leaveMock.mockImplementation(() => Promise.resolve(undefined));
  setViewerRole('parent');

  useAuthStore.setState({
    session: { user: { id: VIEWER_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ManageHouseholdScreen — leaving a household', () => {
  it('offers a non-owner member the way out', async () => {
    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() => expect(getByTestId('household-leave-button')));
  });

  it('never offers it to the OWNER — the owner membership cannot be revoked', async () => {
    // The viewer IS the owner here, so `member('owner-1', 'owner')` is them.
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([member(VIEWER_ID, 'owner')])
    );
    listMembersMock.mockImplementation(() =>
      Promise.resolve([member(VIEWER_ID, 'owner')])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ManageHouseholdScreen />
    );

    await waitFor(() => expect(getByTestId('household-members-section')));
    expect(queryByTestId('household-leave-button')).toBeNull();
  });

  it('confirms before leaving — the action is never one tap', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ManageHouseholdScreen />
    );

    await waitFor(() => expect(getByTestId('household-leave-button')));
    expect(queryByTestId('household-leave-confirm')).toBeNull();

    fireEvent.press(getByTestId('household-leave-button'));
    expect(getByTestId('household-leave-confirm')).toBeTruthy();
    expect(leaveMock).not.toHaveBeenCalled();
  });

  it('cancelling leaves the membership completely alone', async () => {
    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() => expect(getByTestId('household-leave-button')));
    fireEvent.press(getByTestId('household-leave-button'));
    fireEvent.press(getByTestId('household-leave-cancel'));

    expect(leaveMock).not.toHaveBeenCalled();
  });

  it('leaves on confirm, then sends the user back through the entry router', async () => {
    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() => expect(getByTestId('household-leave-button')));
    fireEvent.press(getByTestId('household-leave-button'));
    fireEvent.press(getByTestId('household-leave-confirm'));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(HOUSEHOLD_ID));
    // '/' re-derives where this user belongs from the refetched memberships,
    // rather than this screen guessing at a destination it cannot know.
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(showSuccessToastMock).toHaveBeenCalled();
  });

  it('stays put when the server refuses (clocked in), so nothing is lost', async () => {
    leaveMock.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('conflict'), {
          response: {
            status: 409,
            data: {
              error: {
                code: 'CONFLICT',
                metadata: { reason: 'CANNOT_LEAVE_WHILE_CLOCKED_IN' },
              },
            },
          },
        })
      )
    );

    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() => expect(getByTestId('household-leave-button')));
    fireEvent.press(getByTestId('household-leave-button'));
    fireEvent.press(getByTestId('household-leave-confirm'));

    await waitFor(() =>
      expect(showErrorToastMock).toHaveBeenCalledWith(
        'household:householdSettings.leaveClockedInError'
      )
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
