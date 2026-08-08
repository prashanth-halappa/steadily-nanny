/**
 * @module app/(private)/(tabs)/__tests__/settings.test
 *
 * Source-inspection test for the settings route (Pattern A, docs/09-TESTING.md
 * §5) — settings.tsx pulls in native-heavy deps (BottomSheetBase / sheets), so
 * we assert architectural markers instead of rendering. Covers the
 * delete-account row required by REVIEW-CHECKLIST.md §8 (App Store Guideline
 * 5.1.1(v)). Keyboard occlusion cannot be simulated under bun:test, so the
 * structural contract is asserted instead (same as ReopenWeekDialog.test.tsx).
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../settings.tsx');
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

  it('wires a nanny path to update her availability', () => {
    expect(screenSource).toContain('settings-manage-availability');
    expect(screenSource).toContain('/settings/availability');
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

  it('keeps the inbox Settings link and shows a count badge from useInboxItems', () => {
    expect(screenSource).toContain('settings-inbox');
    expect(screenSource).toContain('useInboxItems');
    expect(screenSource).toContain('inboxBadge');
    expect(screenSource).toContain("router.push('/inbox'");
  });

  it('groups navigable rows with elevation.row surfaces', () => {
    expect(screenSource).toContain('elevation.row');
    expect(screenSource).toContain('rounded-row');
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

  // REGRESSION: the floating tab bar overlays this screen's content instead
  // of reserving its own layout space, so the last rows sat at y≈882–926
  // while the bar started at y≈873 — tapping "Nanny time off" landed on the
  // Hours tab underneath instead. A fixed `paddingBottom: 100` (the old
  // SCREEN_CONTENT_STYLE default) wasn't safe-area-aware and wasn't enough
  // on every device; this screen must size its bottom padding off the real
  // tab bar height + safe-area inset via useTabBarScrollPadding, not a
  // reintroduced magic number. A pixel-accurate "is the last row now above
  // the bar" assertion isn't practical without a real device/layout host —
  // this pins the wiring instead.
  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number', () => {
    expect(screenSource).toContain('useTabBarScrollPadding');
    expect(screenSource).toContain('paddingBottom: tabBarScrollPadding');
  });

  it('offers join-another-household to EVERY role, outside the parent/carer ternary', () => {
    expect(screenSource).toContain('settings-join-household');
    expect(screenSource).toContain("router.push('/settings/join-household'");
    expect(screenSource).toContain("t('household:invite.joinTitle')");
    // A co-parent invited by a second family needs this as much as a nanny
    // does, so the row must sit AFTER the role ternary closes, not inside
    // either arm. `</>\n          )}` is that closing token — the parent arm
    // ends `</>\n          ) : (` instead, so this match is unambiguous.
    const roleTernaryEnd = screenSource.indexOf('</>\n          )}');
    expect(roleTernaryEnd).toBeGreaterThan(-1);
    expect(screenSource.indexOf('settings-join-household')).toBeGreaterThan(
      roleTernaryEnd
    );
  });
});
