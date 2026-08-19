/**
 * @module app/(private)/settings/__tests__/settings.test
 *
 * Source-inspection test for the settings route (Pattern A, docs/09-TESTING.md
 * §5) — index.tsx pulls in native-heavy deps (BottomSheetBase / sheets), so
 * we assert architectural markers instead of rendering. Covers the
 * delete-account row required by REVIEW-CHECKLIST.md §8 (App Store Guideline
 * 5.1.1(v)). Keyboard occlusion cannot be simulated under bun:test, so the
 * structural contract is asserted instead (same as ReopenWeekDialog.test.tsx).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

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
});
