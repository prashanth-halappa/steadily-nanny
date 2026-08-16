/**
 * @module domains/setup/__tests__/ManageHouseholdScreen.carerProfile.test
 *
 * Pattern A (source inspection) — `ManageHouseholdScreen`'s existing render
 * harness (`ManageHouseholdScreen.test.tsx`) mocks a large dependency graph
 * (pickers, currency select, pay-setup prompt) that has nothing to do with
 * this change, and the global `expo-router` preload mints a fresh `push`
 * spy per call so a rendered press can't assert its argument. The wiring —
 * a carer row becomes pressable into `/settings/carer/{userId}`, and a
 * co-parent row does not — is pinned here instead.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/ManageHouseholdScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('ManageHouseholdScreen — carer rows navigate to the carer profile', () => {
  it('wires a testID and route for the carer profile', () => {
    expect(screenSource).toContain('household-member-open-');
    expect(screenSource).toContain('/settings/carer/');
  });

  it('gates navigation on nanny/helper roles, never a co-parent row', () => {
    expect(screenSource).toContain('member.role === HOUSEHOLD_ROLES.NANNY');
    expect(screenSource).toContain('member.role === HOUSEHOLD_ROLES.HELPER');
    expect(screenSource).toContain('isCarer');
  });

  it('keeps the Remove affordance as its own Pressable, not nested inside the new one', () => {
    // Two sibling testIDs on the same row is the ChildRow precedent
    // (edit-area Pressable + a separate remove Pressable) — nesting two
    // Pressables risks swallowing the inner tap.
    const openIdx = screenSource.indexOf('household-member-open-');
    const removeIdx = screenSource.indexOf('household-member-remove-');
    expect(openIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(openIdx);
  });
});
