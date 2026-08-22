/**
 * @module domains/household/components/__tests__/ThisFamilyScreen.leave.test
 *
 * The nanny's own way out, on her own screen. `ManageHouseholdScreen` has had
 * the only "Leave household" button in the app since the pay-loop wave, and
 * that screen hard-gates to parents — so the member the action exists FOR
 * could never reach it.
 *
 * Four states are pinned here because each one is a door that would never
 * open if it were offered:
 *   - `owner`   — a draft-author nanny IS her household's owner, and the
 *                 server answers 403 CANNOT_LEAVE_AS_OWNER.
 *   - `removed` — she has already left; nothing to leave.
 *   - `candidate` — `findActiveMembership` never sees her, so leave 404s.
 *   - clocked in HERE — 409, and the remedy ("clock out first") is the reason
 *                 shown beneath the disabled button.
 * Clocked in at ANOTHER family is deliberately not a refusal: the server
 * scopes its check per household, and rendering family B's clock-in on family
 * A's screen would leak B.
 *
 * The AlertDialog primitive is mocked with a real React context so `open` is
 * actually honoured (the global @rn-primitives stub in `bun.setup.ts` is a
 * passthrough, which would render the confirm at all times and make "the
 * confirm appears only after tapping" untestable). Same mock as
 * `domains/setup/__tests__/ManageHouseholdScreen.leave.test.tsx`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import type React from 'react';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = 'household-1';
const OTHER_HOUSEHOLD_ID = 'household-2';
const VIEWER_ID = 'viewer-1';
const now = '2026-08-01T10:00:00.000Z';

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
  name: 'The Okafor family',
  created_by: 'owner-1',
  address_line: '14 Bell Street',
  timezone: 'Europe/London',
  currency: 'GBP',
  approval_mode: 'either',
  approval_scope: 'all',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_at: now,
  updated_at: now,
};

const member = (
  userId: string,
  role: 'owner' | 'parent' | 'nanny' | 'helper',
  status: 'active' | 'removed' | 'candidate' = 'active'
) => ({
  id: `member-${userId}`,
  household_id: HOUSEHOLD_ID,
  user_id: userId,
  role,
  can_edit: role !== 'nanny',
  status,
  display_name_override: null,
  profile_name: null,
  profile_phone: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
});

const listMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([household])
);
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const leaveMock = mock((_id: string) => Promise.resolve(undefined));
const getRunningMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve(null)
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listMock,
    listPast: mock(() => Promise.resolve([])),
    listMembers: listMembersMock,
    leave: leaveMock,
  },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: mock(() => Promise.resolve([])) },
}));
mock.module('@/src/api/endpoints/householdClosures', () => ({
  householdClosureApi: { list: mock(() => Promise.resolve([])) },
}));
mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: { getRunning: getRunningMock },
}));

const showErrorToastMock = mock((_m: string) => {});
const showSuccessToastMock = mock((_m: string) => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
  showSuccessToast: showSuccessToastMock,
}));

let ThisFamilyScreen: typeof import('../ThisFamilyScreen').ThisFamilyScreen;

beforeAll(async () => {
  ThisFamilyScreen = (await import('../ThisFamilyScreen')).ThisFamilyScreen;
});

/** The viewer's own row, alongside the owner who is never her. */
function setViewerMembership(
  role: 'owner' | 'parent' | 'nanny' | 'helper',
  status: 'active' | 'removed' | 'candidate' = 'active'
) {
  listMembersMock.mockImplementation(() =>
    Promise.resolve(
      role === 'owner'
        ? [member(VIEWER_ID, 'owner', status)]
        : [member('owner-1', 'owner'), member(VIEWER_ID, role, status)]
    )
  );
}

beforeEach(() => {
  listMembersMock.mockReset();
  leaveMock.mockReset();
  replaceMock.mockReset();
  getRunningMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(null));
  leaveMock.mockImplementation(() => Promise.resolve(undefined));
  showErrorToastMock.mockClear();
  showSuccessToastMock.mockClear();
  setViewerMembership('nanny');

  useAuthStore.setState({
    session: { user: { id: VIEWER_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ThisFamilyScreen — leaving the family', () => {
  it('offers the way out to an active nanny, with the hint beneath it', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() => expect(getByTestId('this-family-leave-button')));
    // No restriction reason — the hint takes that slot instead.
    expect(queryByTestId('this-family-leave-button-reason')).toBeNull();
    expect(getByTestId('this-family-leave-hint')).toBeTruthy();
  });

  it('never offers it to the OWNER — a draft-author nanny owns her household', async () => {
    setViewerMembership('owner');

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() => expect(getByTestId('this-family-days-off')));
    expect(queryByTestId('this-family-leave-button')).toBeNull();
  });

  it('never offers it to a REMOVED member — she has already left', async () => {
    setViewerMembership('nanny', 'removed');

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() => expect(getByTestId('this-family-days-off')));
    expect(queryByTestId('this-family-leave-button')).toBeNull();
  });

  it('never offers it to a CANDIDATE — leave 404s before she is hired', async () => {
    setViewerMembership('nanny', 'candidate');

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() => expect(getByTestId('this-family-days-off')));
    expect(queryByTestId('this-family-leave-button')).toBeNull();
  });

  it('disables it with the reason while she is clocked in HERE', async () => {
    getRunningMock.mockImplementation(() =>
      Promise.resolve({ id: 'entry-1', household_id: HOUSEHOLD_ID })
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() =>
      expect(getByTestId('this-family-leave-button-reason')).toBeTruthy()
    );
    // The hint is replaced by the reason, not stacked under it.
    expect(queryByTestId('this-family-leave-hint')).toBeNull();
    // RNTL fires press regardless of `disabled`, so the prop IS the contract
    // here — same as RestrictedActionButton's own test.
    expect(getByTestId('this-family-leave-button').props.disabled).toBe(true);
    expect(getByTestId('this-family-leave-button-reason').props.children).toBe(
      'householdSettings.leaveClockedInError'
    );
  });

  it('stays enabled while she is clocked in at ANOTHER family', async () => {
    getRunningMock.mockImplementation(() =>
      Promise.resolve({ id: 'entry-1', household_id: OTHER_HOUSEHOLD_ID })
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() => expect(getByTestId('this-family-leave-button')));
    // Family B's clock-in is not family A's business, and the server scopes
    // its refusal the same way.
    expect(queryByTestId('this-family-leave-button-reason')).toBeNull();
    fireEvent.press(getByTestId('this-family-leave-button'));
    expect(getByTestId('this-family-leave-confirm')).toBeTruthy();
  });

  it('confirms first, then leaves and sends her back through the entry router', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ThisFamilyScreen />
    );

    await waitFor(() => expect(getByTestId('this-family-leave-button')));
    expect(queryByTestId('this-family-leave-confirm')).toBeNull();

    fireEvent.press(getByTestId('this-family-leave-button'));
    expect(leaveMock).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('this-family-leave-confirm'));

    await waitFor(() => expect(leaveMock).toHaveBeenCalledWith(HOUSEHOLD_ID));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(showSuccessToastMock).toHaveBeenCalled();
  });

  it('stays put when the server refuses, so nothing is silently lost', async () => {
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

    const { getByTestId } = renderWithProviders(<ThisFamilyScreen />);

    await waitFor(() => expect(getByTestId('this-family-leave-button')));
    fireEvent.press(getByTestId('this-family-leave-button'));
    fireEvent.press(getByTestId('this-family-leave-confirm'));

    await waitFor(() =>
      expect(showErrorToastMock).toHaveBeenCalledWith(
        'household:householdSettings.leaveClockedInError'
      )
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
