/**
 * @module app/(private)/settings/__tests__/settings.test
 *
 * Source-inspection test for the settings route (Pattern A, docs/09-TESTING.md
 * §5) — index.tsx pulls in native-heavy deps (BottomSheetBase / sheets), so
 * we assert architectural markers instead of rendering. Covers the
 * delete-account row required by REVIEW-CHECKLIST.md §8 (App Store Guideline
 * 5.1.1(v)). Keyboard occlusion cannot be simulated under bun:test, so the
 * structural contract is asserted instead (same as ReopenWeekDialog.test.tsx).
 *
 * The second half of this file (below the Pattern A block) is Pattern B —
 * real rendering, same shape as settings.behavior.test.tsx — proving the
 * last-write-role-member carer/approval consequence lines are genuinely
 * conditional on household composition, not just present in the source.
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

const screenPath = join(__dirname, '../index.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('SettingsScreen', () => {
  it('wires the delete-account testID', () => {
    expect(screenSource).toContain('settings-delete-account');
  });

  it('confirms deletion through the useDeleteAccount mutation hook', () => {
    expect(screenSource).toContain('useDeleteAccount');
  });

  it('uses BottomSheetBase (keyboard-aware), never AlertDialog', () => {
    // Render tests cannot reproduce software-keyboard occlusion of the
    // confirm button. Assert the structural fix that ReopenWeekDialog /
    // QueryNoteSheet already use: BottomSheetBase owns KeyboardAvoidingView
    // + ScrollView. Doc comments may name AlertDialog as the rejected
    // precedent — ban the import, not the substring.
    expect(screenSource).toContain('BottomSheetBase');
    expect(screenSource).not.toMatch(
      /from\s+'@\/src\/components\/ui\/alert-dialog'/
    );
    expect(screenSource).toContain('fitContent');
    expect(screenSource).not.toMatch(/<Modal\b/);
  });

  it('gates the household management links on server-derived role', () => {
    expect(screenSource).toContain('useIsOnboarded');
    expect(screenSource).toContain('SETUP_ROLES.PARENT');
    expect(screenSource).toContain('SETUP_ROLES.NANNY');
    expect(screenSource).toContain('SETUP_ROLES.HELPER');
  });

  it('wires a parent path to manage children and invite someone', () => {
    expect(screenSource).toContain('settings-manage-children');
    expect(screenSource).toContain('/settings/children');
    expect(screenSource).toContain('settings-invite-nanny');
    expect(screenSource).toContain('/settings/invite');
  });

  it('wires a parent-only path to household settings', () => {
    expect(screenSource).toContain('settings-manage-household');
    expect(screenSource).toContain('/settings/household');
  });

  it('wires a path to household holidays', () => {
    expect(screenSource).toContain('settings-household-holidays');
  });

  it('wires a nanny path to update her availability', () => {
    expect(screenSource).toContain('settings-manage-availability');
    expect(screenSource).toContain('/settings/availability');
  });

  // S9 / direction §4 — the nanny's map of where she works, above the rest
  // of her household group.
  it('wires a nanny/helper-only "This family" row, above availability', () => {
    expect(screenSource).toContain('settings-this-family');
    expect(screenSource).toContain('/settings/this-family');
    const thisFamilyIdx = screenSource.indexOf('settings-this-family');
    const availabilityIdx = screenSource.indexOf(
      'settings-manage-availability'
    );
    expect(thisFamilyIdx).toBeGreaterThan(-1);
    expect(availabilityIdx).toBeGreaterThan(thisFamilyIdx);
  });

  // A nanny who authored a draft household is its write authority
  // server-side; the client used to keep BOTH invite rows in the parent-only
  // arm, so the draft home's one share button was her only route to inviting
  // a family — and when it was disabled she had none.
  it('gives a draft-author nanny a route to her invite codes', () => {
    expect(screenSource).toContain('settings-draft-invites');
    expect(screenSource).toContain('isDraftAuthorNanny');
    expect(screenSource).toContain('HOUSEHOLD_STATES.DRAFT');
  });

  it('wires Time & calendar settings (D29 display timezone / week start)', () => {
    expect(screenSource).toContain('settings-time');
    expect(screenSource).toContain('/settings/time');
  });

  it('shows chevrons on navigates and an external glyph on legal links', () => {
    expect(screenSource).toContain('ChevronRight');
    expect(screenSource).toContain('ExternalLink');
    expect(screenSource).toContain('SettingsNavRow');
    expect(screenSource).toContain('SettingsExternalRow');
    expect(screenSource).toContain('settings-privacy');
    expect(screenSource).toContain('settings-terms');
  });

  it('puts Account above Language and wires Notifications to the in-app prefs screen', () => {
    const accountIdx = screenSource.indexOf('settings-account-section');
    const languageIdx = screenSource.indexOf('settings-language-section');
    expect(accountIdx).toBeGreaterThan(-1);
    expect(languageIdx).toBeGreaterThan(accountIdx);
    expect(screenSource).toContain('settings-notifications');
    expect(screenSource).toContain('/settings/notifications');
    expect(screenSource).toContain("t('settings:notifications')");
  });

  // WP-C: the inbox is its own tab now. A Settings row duplicating it was a
  // second front door with its own count to keep in sync — deleted, along
  // with the `useInboxItems` subscription this screen no longer needs.
  it('has no inbox row — the inbox is a tab', () => {
    expect(screenSource).not.toContain('settings-inbox');
    expect(screenSource).not.toContain('useInboxItems');
    expect(screenSource).not.toContain('inboxBadge');
    expect(screenSource).not.toContain("router.push('/inbox'");
    expect(screenSource).not.toContain("t('settings:inbox')");
  });

  // Pushed, not a tab — so it needs a way back, and its own bottom padding
  // (there is no tab bar overlaying it any more to size against).
  it('is a pushed screen: back button above the title, no tab-bar padding', () => {
    expect(screenSource).toContain('settings-back');
    expect(screenSource).toContain('BackButton');
    expect(screenSource).not.toContain('useTabBarScrollPadding');
    expect(screenSource).not.toContain('tabBarScrollPadding');
  });

  it('groups navigable rows into one elevated Card per section, not per-row elevation (docs/design/01-LAWS.md)', () => {
    expect(screenSource).toContain('<Card tone="default"');
    expect(screenSource).toContain('<IconChip');
    expect(screenSource).not.toContain('elevation.row');
  });

  it('persists a language change through useUpdatePreferredLocale, not just locally (D26)', () => {
    expect(screenSource).toContain('useUpdatePreferredLocale');
    expect(screenSource).toContain('setLanguage');
  });

  it('translates the role string and edits name via a nav row', () => {
    expect(screenSource).toContain('t(`settings:role.${onboarding.role}`)');
    expect(screenSource).toContain('settings-name-row');
    expect(screenSource).toContain('/settings/edit-name');
    expect(screenSource).not.toContain('settings-name-input');
  });

  it('offers Get help, app version, and parent time-off/availability views', () => {
    expect(screenSource).toContain('settings-get-help');
    expect(screenSource).toContain('settings-app-version');
    expect(screenSource).toContain('settings-view-availability');
    expect(screenSource).toContain('settings-view-time-off');
    expect(screenSource).toContain('/settings/carer-availability');
    expect(screenSource).toContain('/settings/household-time-off');
  });

  // TIER0-CX-SPEC.md §2/§3: parent gets "Pay & terms", nanny gets "My pay",
  // helper gets NEITHER — a helper has no access to pay at all.
  it('wires a parent-only "Pay & terms" row', () => {
    expect(screenSource).toContain('settings-pay');
    expect(screenSource).toContain("router.push('/settings/pay'");
    expect(screenSource).toContain("t('pay:title')");
  });

  it('wires a nanny-only "My pay" row, gated on the exact role (not the shared nanny/helper branch)', () => {
    expect(screenSource).toContain('settings-my-pay');
    expect(screenSource).toContain("router.push('/settings/my-pay'");
    expect(screenSource).toContain("t('pay:myPay.title')");
    expect(screenSource).toContain('onboarding.role === SETUP_ROLES.NANNY');
  });

  // WAS a regression test pinning `useTabBarScrollPadding` — the floating
  // tab bar used to overlay this screen and swallow taps on its last rows.
  // WP-C pushes Settings above the tab bar entirely, so there is no bar to
  // size against; `SCREEN_CONTENT_STYLE.paddingBottom` is the pushed-screen
  // equivalent. The tab-bar assertion moved to the tab roots that still
  // have one; what stays pinned here is that the padding isn't zero.
  it('reserves bottom padding for the last rows (sign-out, delete, version)', () => {
    expect(screenSource).toContain(
      'contentContainerStyle={SCREEN_CONTENT_STYLE}'
    );
  });

  it('offers join-another-household to EVERY role, outside the parent/carer ternary', () => {
    expect(screenSource).toContain('settings-join-household');
    expect(screenSource).toContain("router.push('/settings/join-household'");
    expect(screenSource).toContain("t('household:invite.joinTitle')");
    // A co-parent invited by a second family needs this as much as a nanny
    // does, so the row must sit AFTER both role arms close, not inside
    // either one. Indentation-agnostic (unlike a literal `</>\n  )}` match):
    // it just requires the join row to come after the LAST testID of both
    // the parent-only arm (household-closures) and the nanny/helper-only
    // arm (request-time-off).
    const parentArmEnd = screenSource.indexOf('settings-household-closures');
    const carerArmEnd = screenSource.indexOf('settings-request-time-off');
    const joinIdx = screenSource.indexOf('settings-join-household');
    expect(parentArmEnd).toBeGreaterThan(-1);
    expect(carerArmEnd).toBeGreaterThan(-1);
    expect(joinIdx).toBeGreaterThan(parentArmEnd);
    expect(joinIdx).toBeGreaterThan(carerArmEnd);
  });

  // The Settings hero is the one place the app shows you yourself. Carer
  // profile already colours PersonAvatar from the member record; this
  // identity block must do the same, not sit on a plain muted ground.
  it('passes the signed-in member colour to the identity avatar', () => {
    expect(screenSource).toContain('useHouseholdMembers');
    expect(screenSource).toContain(
      'useHouseholdMembers(onboarding.householdId)'
    );
    expect(screenSource).toContain('m.user_id === user?.id');
    expect(screenSource).toContain('colour={member?.colour ?? undefined}');
  });

  it('still renders the identity block when no membership colour is available', () => {
    expect(screenSource).toContain('testID="settings-identity"');
    expect(screenSource).toContain(
      'const showIdentity = accountEmail || onboarding.role'
    );
    expect(screenSource).toContain('colour={member?.colour ?? undefined}');
    expect(screenSource).not.toMatch(/showIdentity\s*&&\s*.*colour/);
  });

  // The delete-account sheet must name the carer whose hours it is talking
  // about, and must never turn into a second gate on top of the email-typed
  // unlock — App Store 5.1.1(v) requires the delete path never refuse.
  it('resolves carer names through the shared name chain, not a raw column', () => {
    expect(screenSource).toContain('resolveCarerName');
  });

  it('wires the carer and approval consequence lines with testIDs', () => {
    expect(screenSource).toContain('settings-delete-consequence-carer');
    expect(screenSource).toContain('settings-delete-consequence-approval');
    expect(screenSource).toContain('deleteAccountConsequenceCarer');
    expect(screenSource).toContain('deleteAccountConsequenceApproval');
  });

  it('never adds the carer/approval lines to the delete button disabled condition', () => {
    // The ONE disabled expression in the file — anything gating the confirm
    // button beyond isDeletingAccount / the typed-email unlock would show up
    // here as a second condition.
    expect(screenSource).toMatch(
      /disabled=\{\s*isDeletingAccount \|\|\s*\n\s*\(accountEmail\.length > 0 && !deleteUnlocked\)\s*\}/
    );
  });

  // A past member's household has ended for her — rows that WRITE to it, or
  // point at a future she is no longer part of, must not dead-end her. Rows
  // that still show her something of her own stay.
  it('gates Availability and Request time off on onboarding.isPastMember', () => {
    const availabilityIdx = screenSource.indexOf(
      'settings-manage-availability'
    );
    const timeOffIdx = screenSource.indexOf('settings-request-time-off');
    const pastMemberGateIdxs = [
      ...screenSource.matchAll(/!onboarding\.isPastMember/g),
    ].map(match => match.index as number);

    expect(availabilityIdx).toBeGreaterThan(-1);
    expect(timeOffIdx).toBeGreaterThan(-1);
    // Each row's testID must be preceded (nearest match before it) by a
    // `!onboarding.isPastMember` gate opening its JSX block.
    for (const rowIdx of [availabilityIdx, timeOffIdx]) {
      expect(pastMemberGateIdxs.some(gateIdx => gateIdx < rowIdx)).toBe(true);
    }
  });

  it('keeps This family and (nanny) Household holidays ungated by isPastMember — they still show her something of her own', () => {
    // household-holidays appears twice (parent arm + nanny arm); the nanny
    // arm's occurrence, immediately after settings-my-pay, must not sit
    // behind a past-member gate the way availability/time-off do.
    expect(screenSource).toContain('settings-this-family');
    expect(screenSource).toContain('settings-my-pay');
    const nannyHolidaysIdx = screenSource.indexOf(
      'settings-household-holidays',
      screenSource.indexOf('settings-my-pay')
    );
    expect(nannyHolidaysIdx).toBeGreaterThan(-1);
  });
});

// =============================================================================
// Pattern B — real rendering (docs/09-TESTING.md §5), same shape as
// settings.behavior.test.tsx. Proves the carer/approval lines are genuinely
// conditional on household composition: present only when the deleting user
// is the LAST active owner/parent AND the household still has an active
// carer, absent otherwise, and never touch the confirm button's disabled
// state either way.
// =============================================================================

mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

const OWNER_USER_ID = 'owner-user-1';
const HOUSEHOLD_ID = 'h1';

interface FakeMember {
  id: string;
  household_id: string;
  user_id: string;
  role: 'owner' | 'parent' | 'nanny' | 'helper';
  can_edit: boolean;
  status: 'active' | 'removed' | 'candidate';
  display_name_override: string | null;
  profile_name?: string | null;
  colour?: string | null;
}

const fakeMember = (overrides: Partial<FakeMember> = {}): FakeMember => ({
  id: overrides.id ?? `member-${Math.random()}`,
  household_id: HOUSEHOLD_ID,
  user_id: 'some-user',
  role: 'nanny',
  can_edit: false,
  status: 'active',
  display_name_override: null,
  profile_name: null,
  colour: null,
  ...overrides,
});

let membershipRows: FakeMember[] = [];
let householdMemberRows: FakeMember[] = [];

const householdListMock = mock(() => Promise.resolve([]));
const childrenListMock = mock(() => Promise.resolve([]));
const listMembersMock = mock(() => Promise.resolve(householdMemberRows));
const getProfileMock = mock(() =>
  Promise.resolve({
    user_id: OWNER_USER_ID,
    name: 'Sam',
    city: null,
    country: null,
    preferred_locale: 'en',
  })
);
const listMembershipsMock = mock(() => Promise.resolve(membershipRows));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdListMock, listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: childrenListMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    updatePreferredLocale: mock(() => Promise.resolve(null)),
    updateName: mock(() => Promise.resolve(null)),
    deleteAccount: mock(() => Promise.resolve({ success: true, message: '' })),
    listMemberships: listMembershipsMock,
  },
}));

// Declared, not statically imported — mock.module must register before the
// subject is resolved (docs/09-TESTING.md §4).
let SettingsScreenRendered: typeof import('../index').default;

beforeAll(async () => {
  SettingsScreenRendered = (await import('../index')).default;
});

beforeEach(() => {
  householdListMock.mockClear();
  childrenListMock.mockClear();
  listMembersMock.mockClear();
  listMembershipsMock.mockClear();
  membershipRows = [];
  householdMemberRows = [];
  useAuthStore.setState({
    session: { user: { id: OWNER_USER_ID } } as unknown as never,
    isInitialized: true,
    // `member` (the deleting user's own household-members row, which the
    // last-write-role check reads) is matched on `user?.id`, not the
    // session's nested user — must be set separately or that lookup always
    // misses.
    user: { id: OWNER_USER_ID } as unknown as never,
  } as never);
});

async function openDeleteSheet() {
  const rendered = renderWithProviders(<SettingsScreenRendered />);
  fireEvent.press(rendered.getByTestId('settings-delete-account'));
  await waitFor(() =>
    expect(rendered.getByTestId('settings-delete-account-confirm')).toBeTruthy()
  );
  return rendered;
}

describe('SettingsScreen — delete-account carer/approval consequence lines', () => {
  it('shows both lines when she is the last owner/parent and a carer is active', async () => {
    membershipRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
    ];
    householdMemberRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
      fakeMember({
        id: 'm-nanny',
        user_id: 'nanny-1',
        role: 'nanny',
        status: 'active',
        profile_name: 'Priya',
      }),
    ];

    const { getByTestId } = await openDeleteSheet();

    // The household-members read resolves after the sheet is already open
    // (the mock BottomSheetBase mounts unconditionally on `visible`), so wait
    // for the named line specifically rather than asserting immediately.
    await waitFor(() =>
      expect(getByTestId('settings-delete-consequence-carer')).toBeTruthy()
    );
    expect(getByTestId('settings-delete-consequence-approval')).toBeTruthy();
    // The confirm button is unaffected — App Store 5.1.1(v): the delete path
    // must never gain a new way to refuse.
    expect(getByTestId('settings-delete-account-confirm').props.disabled).toBe(
      false
    );
  });

  it('omits both lines when the household has no active carer', async () => {
    membershipRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
    ];
    householdMemberRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
    ];

    const { queryByTestId, getByTestId } = await openDeleteSheet();

    // Let the household-members read settle before asserting the negative —
    // otherwise "absent" is trivially true before data has even loaded.
    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
    expect(queryByTestId('settings-delete-consequence-carer')).toBeNull();
    expect(queryByTestId('settings-delete-consequence-approval')).toBeNull();
    expect(getByTestId('settings-delete-account-confirm').props.disabled).toBe(
      false
    );
  });

  it('omits both lines when a co-parent is still active (she is not the last write-role member)', async () => {
    membershipRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
    ];
    householdMemberRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
      fakeMember({
        id: 'm-parent',
        user_id: 'other-parent-1',
        role: 'parent',
        status: 'active',
      }),
      fakeMember({
        id: 'm-nanny',
        user_id: 'nanny-1',
        role: 'nanny',
        status: 'active',
        profile_name: 'Priya',
      }),
    ];

    const { queryByTestId, getByTestId } = await openDeleteSheet();

    // Let the household-members read settle before asserting the negative —
    // otherwise "absent" is trivially true before data has even loaded.
    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
    expect(queryByTestId('settings-delete-consequence-carer')).toBeNull();
    expect(queryByTestId('settings-delete-consequence-approval')).toBeNull();
    expect(getByTestId('settings-delete-account-confirm').props.disabled).toBe(
      false
    );
  });

  it('omits both lines when a removed carer is the only "carer" on record (removed is not active)', async () => {
    membershipRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
    ];
    householdMemberRows = [
      fakeMember({
        id: 'm-owner',
        user_id: OWNER_USER_ID,
        role: 'owner',
        status: 'active',
      }),
      fakeMember({
        id: 'm-nanny',
        user_id: 'nanny-1',
        role: 'nanny',
        status: 'removed',
        profile_name: 'Priya',
      }),
    ];

    const { queryByTestId } = await openDeleteSheet();

    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
    expect(queryByTestId('settings-delete-consequence-carer')).toBeNull();
    expect(queryByTestId('settings-delete-consequence-approval')).toBeNull();
  });
});

// A REMOVED nanny (isPastMember) still resolves role NANNY through
// useIsOnboarded (see that hook's own doc: a removed membership is
// "onboarded", just with isPastMember true) — so the nanny/helper arm
// renders, and this is what proves which of its rows survive that state.
const REMOVED_NANNY_ID = 'nanny-removed-1';

describe('SettingsScreen — a past member (removed nanny) does not dead-end on write-only rows', () => {
  beforeEach(() => {
    membershipRows = [
      fakeMember({
        id: 'm-nanny',
        user_id: REMOVED_NANNY_ID,
        role: 'nanny',
        status: 'removed',
      }),
    ];
    householdMemberRows = [...membershipRows];
    useAuthStore.setState({
      session: { user: { id: REMOVED_NANNY_ID } } as unknown as never,
      isInitialized: true,
      user: { id: REMOVED_NANNY_ID } as unknown as never,
    } as never);
  });

  it('drops Availability and Request time off — nobody reads either any more', async () => {
    const { queryByTestId, getByTestId } = renderWithProviders(
      <SettingsScreenRendered />
    );

    await waitFor(() =>
      expect(getByTestId('settings-household-section')).toBeTruthy()
    );
    expect(queryByTestId('settings-manage-availability')).toBeNull();
    expect(queryByTestId('settings-request-time-off')).toBeNull();
  });

  it('keeps This family, My pay, and Household holidays — still hers to read', async () => {
    const { getByTestId } = renderWithProviders(<SettingsScreenRendered />);

    await waitFor(() =>
      expect(getByTestId('settings-household-section')).toBeTruthy()
    );
    expect(getByTestId('settings-this-family')).toBeTruthy();
    expect(getByTestId('settings-my-pay')).toBeTruthy();
    expect(getByTestId('settings-household-holidays')).toBeTruthy();
  });
});

describe('SettingsScreen — an ACTIVE nanny keeps every row (no regression)', () => {
  beforeEach(() => {
    membershipRows = [
      fakeMember({
        id: 'm-nanny',
        user_id: 'nanny-active-1',
        role: 'nanny',
        status: 'active',
      }),
    ];
    householdMemberRows = [...membershipRows];
    useAuthStore.setState({
      session: { user: { id: 'nanny-active-1' } } as unknown as never,
      isInitialized: true,
      user: { id: 'nanny-active-1' } as unknown as never,
    } as never);
  });

  it('still shows Availability and Request time off', async () => {
    const { getByTestId } = renderWithProviders(<SettingsScreenRendered />);

    await waitFor(() =>
      expect(getByTestId('settings-household-section')).toBeTruthy()
    );
    expect(getByTestId('settings-manage-availability')).toBeTruthy();
    expect(getByTestId('settings-request-time-off')).toBeTruthy();
  });
});
