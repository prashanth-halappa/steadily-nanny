/**
 * @module app/(private)/(tabs)/__tests__/settings.test
 *
 * Source-inspection test for the settings route (Pattern A, docs/09-TESTING.md
 * §5) — settings.tsx pulls in native-heavy deps (AlertDialog primitives), so we
 * assert architectural markers instead of rendering. Covers the delete-account
 * row required by REVIEW-CHECKLIST.md §8 (App Store Guideline 5.1.1(v)).
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

  it('confirms via AlertDialog, never a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(screenSource).toContain('AlertDialog');
    expect(screenSource).not.toMatch(/<Modal\b/);
  });

  it('gates the household management links on server-derived role', () => {
    expect(screenSource).toContain('useIsOnboarded');
    expect(screenSource).toContain('SETUP_ROLES.PARENT');
    expect(screenSource).toContain('SETUP_ROLES.NANNY');
  });

  it('wires a parent path to manage children and invite another nanny', () => {
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

  it('persists a language change through useUpdatePreferredLocale, not just locally (D26)', () => {
    expect(screenSource).toContain('useUpdatePreferredLocale');
    expect(screenSource).toContain('setLanguage');
  });
});
