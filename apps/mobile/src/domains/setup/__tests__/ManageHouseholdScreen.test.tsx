/**
 * @module domains/setup/__tests__/ManageHouseholdScreen.test
 *
 * Renders the REAL `ManageHouseholdScreen` — not a component fed mocked
 * props/callbacks — against a real QueryClient, with only the API leaf
 * (`householdApi`, `childrenApi`) and the real Zustand auth store mocked.
 * D15 shipped broken because its test handed `onPreviousWeek`/`onNextWeek`
 * straight to the component under test, which could prove the component
 * works in isolation but could never prove anything in the app actually
 * calls it. This file exists specifically to not repeat that mistake:
 * it presses the real Save CTA and asserts the real mutation hook's
 * underlying API call, wired through `useIsOnboarded`/`useHouseholds`
 * exactly as the shipped screen does.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

// Declared, not statically imported: `ManageHouseholdScreen` transitively
// pulls in `@rn-primitives/alert-dialog` via `alert-dialog.tsx`, and a
// static import resolves that whole tree before the `mock.module` calls
// below ever run — see the alert-dialog mock's header comment.
let ManageHouseholdScreen: typeof import('../components/ManageHouseholdScreen').ManageHouseholdScreen;

// `LoadingIndicator` imports `assets/splash.png` directly — bun:test has no
// Metro asset transform, so parsing the raw PNG bytes as a module crashes.
// Same fix as PendingScheduleCard.test.tsx.
mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

// Same precedent as loading-button.test.tsx / ClockInCard.behavior.test.tsx —
// pinned explicitly even though nativewind's mocked useColorScheme already
// resolves to 'light'.
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

// `@rn-primitives/alert-dialog`'s .mjs distribution isn't pre-compiled JSX,
// which crashes bun:test ("Unexpected <") — it isn't in the global preload's
// @rn-primitives mock set (only slot/portal/progress/label are), and nothing
// else in this codebase has ever rendered a real AlertDialog in a test
// (`settings.test.tsx` is Pattern A / source-inspection). A minimal
// context-based stand-in, faithful enough to Radix's open/onOpenChange
// contract for this screen's controlled dialog and `useRootContext` (which
// `AlertDialogContent` calls unconditionally, native included).
mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const setOpen = (next: boolean) => onOpenChange?.(next);
      return React.createElement(
        Ctx.Provider,
        { value: { open: open ?? false, setOpen } },
        children
      );
    },
    Trigger: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            onPress?.(e);
            if (!disabled) setOpen(true);
          },
        },
        children
      );
    },
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const { open } = React.useContext(Ctx);
      return open ? React.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
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
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
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
    useRootContext: () => React.useContext(Ctx),
  };
});

const PARENT_USER_ID = 'parent-user-1';
const NANNY_USER_ID = 'nanny-user-1';
const HOUSEHOLD_ID = 'household-1';
const now = '2026-01-01T00:00:00.000Z';

const baseHousehold = {
  id: HOUSEHOLD_ID,
  name: 'The Smiths',
  timezone: 'Europe/London',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: PARENT_USER_ID,
  created_at: now,
  updated_at: now,
};

const listMock = mock(() => Promise.resolve([baseHousehold]));
const updateMock = mock((_id: string, input: unknown) =>
  Promise.resolve({ ...baseHousehold, ...(input as object) })
);
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const updateMemberMock = mock(
  (_householdId: string, memberId: string, input: unknown) =>
    Promise.resolve({ id: memberId, ...(input as object) })
);
const childrenListMock = mock(() =>
  Promise.resolve([{ id: 'child-1', name: 'Ada', age: 4 }])
);
// PaySetupPromptCard's own hook — resolves `null` (no arrangement) by
// default so the card renders whenever a test supplies an active nanny.
const payCurrentMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve(null)
);
const membershipsListMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([
    {
      id: 'member-1',
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
    update: updateMock,
    listMembers: listMembersMock,
    updateMember: updateMemberMock,
  },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: childrenListMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: mock(() => Promise.resolve([])),
    create: mock(),
  },
}));

beforeAll(async () => {
  ManageHouseholdScreen = (await import('../components/ManageHouseholdScreen'))
    .ManageHouseholdScreen;
});

beforeEach(() => {
  listMock.mockReset();
  updateMock.mockReset();
  listMembersMock.mockReset();
  updateMemberMock.mockReset();
  childrenListMock.mockReset();
  membershipsListMock.mockReset();
  payCurrentMock.mockReset();
  listMembersMock.mockImplementation(() => Promise.resolve([]));
  updateMemberMock.mockImplementation(
    (_householdId: string, memberId: string, input: unknown) =>
      Promise.resolve({ id: memberId, ...(input as object) })
  );
  payCurrentMock.mockImplementation(() => Promise.resolve(null));
  listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
  updateMock.mockImplementation((_id: string, input: unknown) =>
    Promise.resolve({ ...baseHousehold, ...(input as object) })
  );
  childrenListMock.mockImplementation(() =>
    Promise.resolve([{ id: 'child-1', name: 'Ada', age: 4 }])
  );
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([
      {
        id: 'member-1',
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
  // Real Zustand store, same pattern as useIsOnboarded.test.ts /
  // ClockInCard.behavior.test.tsx — not mocked.
  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ManageHouseholdScreen', () => {
  it('seeds the form from the real household, saves a changed name through the real mutation, and sends ONLY that field', async () => {
    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() =>
      expect(getByTestId('household-name-input').props.value).toBe('The Smiths')
    );

    fireEvent.changeText(
      getByTestId('household-name-input'),
      'The Reyes Household'
    );
    fireEvent.press(getByTestId('manage-household-screen-cta'));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
        name: 'The Reyes Household',
      })
    );
  });

  it('keeps Save disabled and never calls the mutation when nothing changed', async () => {
    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() =>
      expect(getByTestId('household-name-input').props.value).toBe('The Smiths')
    );

    const cta = getByTestId('manage-household-screen-cta');
    expect(cta.props.disabled).toBe(true);

    fireEvent.press(cta);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range approval field client-side and never calls the mutation', async () => {
    const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

    await waitFor(() =>
      expect(getByTestId('household-name-input').props.value).toBe('The Smiths')
    );

    // 337 > the schema's 336-hour max.
    fireEvent.changeText(
      getByTestId('household-short-notice-hours-input'),
      '337'
    );
    fireEvent.press(getByTestId('manage-household-screen-cta'));

    expect(updateMock).not.toHaveBeenCalled();
  });

  // `membershipsListMock` (unlike `listMock`) does not consult the auth
  // store — it is a static fixture. Setting only `useAuthStore`'s session
  // does NOT change the resolved role; the membership row's own `role`
  // does. Both nanny-role tests below repoint it to a nanny membership so
  // `useIsOnboarded` genuinely resolves a non-parent role, rather than
  // relying on catching the component mid-loading-state.
  const nannyMembership = {
    id: 'member-2',
    household_id: HOUSEHOLD_ID,
    user_id: NANNY_USER_ID,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
  };

  it('is parent-only: a nanny (member, not creator) never sees the form, even navigating here directly', async () => {
    useAuthStore.setState({
      session: { user: { id: NANNY_USER_ID } } as unknown as never,
      isInitialized: true,
    } as never);
    listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
    childrenListMock.mockImplementation(() => Promise.resolve([]));
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([nannyMembership])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ManageHouseholdScreen />
    );

    await waitFor(() =>
      expect(getByTestId('manage-household-not-available')).toBeTruthy()
    );
    expect(queryByTestId('household-name-input')).toBeNull();
  });

  // REGRESSION: a bare `null` for the wrong role left a deep-linked nanny/
  // helper staring at a blank screen — no message, no back affordance,
  // nothing. Now mirrors TimeOffScreen's `time-off-not-available` pattern:
  // an EmptyState plus a real way back.
  it('REGRESSION: a non-parent sees an honest not-available state with a back affordance, never a blank screen', async () => {
    useAuthStore.setState({
      session: { user: { id: NANNY_USER_ID } } as unknown as never,
      isInitialized: true,
    } as never);
    listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
    childrenListMock.mockImplementation(() => Promise.resolve([]));
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([nannyMembership])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ManageHouseholdScreen />
    );

    await waitFor(() =>
      expect(getByTestId('manage-household-not-available')).toBeTruthy()
    );
    expect(queryByTestId('manage-household-screen')).toBeNull();

    // Must not throw — proves the back affordance is a real callback.
    fireEvent.press(getByTestId('manage-household-not-available-back'));
  });

  // TIER0-CX-SPEC.md §2 "First-time setup", entry point 1.
  describe('pay setup prompt card', () => {
    const activeNannyMember = {
      id: 'member-3',
      household_id: HOUSEHOLD_ID,
      user_id: 'nanny-with-no-arrangement',
      role: 'nanny',
      can_edit: false,
      status: 'active',
      display_name_override: 'Priya',
      colour: null,
      joined_at: now,
      created_at: now,
      updated_at: now,
    };

    it('appears for an active nanny with no pay arrangement', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([activeNannyMember])
      );
      payCurrentMock.mockImplementation(() => Promise.resolve(null));

      const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

      await waitFor(() =>
        expect(
          getByTestId(`pay-setup-prompt-${activeNannyMember.user_id}`)
        ).toBeTruthy()
      );
    });

    it('does not appear once that nanny already has an arrangement', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([activeNannyMember])
      );
      payCurrentMock.mockImplementation(() =>
        Promise.resolve({
          id: 'arr-1',
          household_id: HOUSEHOLD_ID,
          carer_id: activeNannyMember.user_id,
          rate_minor: 1850,
          bill_rate_minor: null,
          currency: 'GBP',
          overtime_threshold_minutes: null,
          overtime_multiplier: 1.5,
          guaranteed_minutes_per_week: null,
          pto_entitlement_minutes_per_year: null,
          mileage_rate_per_mile_minor: null,
          cancellation_paid_within_hours: null,
          valid_from: '2026-04-01',
          carer_display_name: 'Priya',
          note: null,
          created_by: PARENT_USER_ID,
          created_at: now,
        })
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <ManageHouseholdScreen />
      );

      await waitFor(() =>
        expect(getByTestId('household-name-input')).toBeTruthy()
      );
      expect(
        queryByTestId(`pay-setup-prompt-${activeNannyMember.user_id}`)
      ).toBeNull();
    });

    it('does not appear for a removed (inactive) nanny', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([{ ...activeNannyMember, status: 'removed' }])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <ManageHouseholdScreen />
      );

      await waitFor(() =>
        expect(getByTestId('household-name-input')).toBeTruthy()
      );
      expect(
        queryByTestId(`pay-setup-prompt-${activeNannyMember.user_id}`)
      ).toBeNull();
    });
  });

  // D3: remove member.
  describe('member removal', () => {
    const ownerMember = {
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
    };
    const removableNanny = {
      id: 'member-nanny',
      household_id: HOUSEHOLD_ID,
      user_id: NANNY_USER_ID,
      role: 'nanny',
      can_edit: false,
      status: 'active',
      display_name_override: 'Priya',
      colour: null,
      joined_at: now,
      created_at: now,
      updated_at: now,
    };
    const COPARENT_USER_ID = 'coparent-user-1';
    const coparentMember = {
      id: 'member-coparent',
      household_id: HOUSEHOLD_ID,
      user_id: COPARENT_USER_ID,
      role: 'parent',
      can_edit: true,
      status: 'active',
      display_name_override: null,
      colour: null,
      joined_at: now,
      created_at: now,
      updated_at: now,
    };

    it('shows Remove on a nanny card but hides it on the owner card, for the owner viewer', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([ownerMember, removableNanny])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <ManageHouseholdScreen />
      );

      await waitFor(() =>
        expect(getByTestId('household-name-input')).toBeTruthy()
      );
      expect(
        getByTestId(`household-member-remove-${removableNanny.id}`)
      ).toBeTruthy();
      expect(
        queryByTestId(`household-member-remove-${ownerMember.id}`)
      ).toBeNull();
    });

    it("hides Remove on the viewer's own card even for a non-owner parent", async () => {
      useAuthStore.setState({
        session: { user: { id: COPARENT_USER_ID } } as unknown as never,
        isInitialized: true,
      } as never);
      membershipsListMock.mockImplementation(() =>
        Promise.resolve([coparentMember])
      );
      listMembersMock.mockImplementation(() =>
        Promise.resolve([ownerMember, removableNanny, coparentMember])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <ManageHouseholdScreen />
      );

      await waitFor(() =>
        expect(getByTestId('household-name-input')).toBeTruthy()
      );
      expect(
        getByTestId(`household-member-remove-${removableNanny.id}`)
      ).toBeTruthy();
      expect(
        queryByTestId(`household-member-remove-${coparentMember.id}`)
      ).toBeNull();
      expect(
        queryByTestId(`household-member-remove-${ownerMember.id}`)
      ).toBeNull();
    });

    it('presses Remove, confirms, and calls useRemoveMember through to householdApi.updateMember', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([ownerMember, removableNanny])
      );

      const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

      await waitFor(() =>
        expect(getByTestId('household-name-input')).toBeTruthy()
      );

      fireEvent.press(
        getByTestId(`household-member-remove-${removableNanny.id}`)
      );
      fireEvent.press(getByTestId('household-member-remove-confirm'));

      await waitFor(() =>
        expect(updateMemberMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          removableNanny.id,
          { status: 'removed' }
        )
      );
    });

    it('never calls the mutation if the confirm dialog is cancelled', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([ownerMember, removableNanny])
      );

      const { getByTestId } = renderWithProviders(<ManageHouseholdScreen />);

      await waitFor(() =>
        expect(getByTestId('household-name-input')).toBeTruthy()
      );

      fireEvent.press(
        getByTestId(`household-member-remove-${removableNanny.id}`)
      );
      fireEvent.press(getByTestId('household-member-remove-cancel'));

      expect(updateMemberMock).not.toHaveBeenCalled();
    });
  });
});
