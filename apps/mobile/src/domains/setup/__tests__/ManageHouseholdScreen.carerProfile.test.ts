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

describe('ManageHouseholdScreen — member list grouping (01-LAWS 6)', () => {
  it('wraps active members in one ListGroup and drops per-row borders', () => {
    // Bare bordered boxes on bg-background are list hairlines (law 6). Rule D's
    // inset-hairline exception only applies INSIDE a group card — ListGroup.
    expect(screenSource).toContain('<ListGroup>');
    expect(screenSource).toContain('</ListGroup>');

    const membersIdx = screenSource.indexOf(
      'testID="household-members-section"'
    );
    expect(membersIdx).toBeGreaterThan(-1);
    const membersWindow = screenSource.slice(membersIdx, membersIdx + 2200);
    expect(membersWindow).toContain('activeMembers.map');
    expect(membersWindow).toContain('<ListGroup>');
    expect(membersWindow).not.toMatch(
      /household-member-row-\$\{member\.id\}[\s\S]{0,200}border border-border/
    );
  });

  it('keeps member rows flush with the ListGroup card surface', () => {
    // ListRow contract: no elevation and no rounded corners of its own — the
    // group clips and lifts. bg-background is the page ground, so painting it
    // inside Card tone="default" (white) reads as a grey block in a white card.
    const rowMatch = screenSource.match(
      /testID=\{`household-member-row-\$\{member\.id\}`\}\s+className="([^"]+)"/
    );
    expect(rowMatch).not.toBeNull();
    const rowClassName = rowMatch?.[1] ?? '';
    expect(rowClassName).not.toContain('bg-background');
    expect(rowClassName).not.toContain('rounded-row');
  });
});
