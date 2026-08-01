/**
 * @module app/(private)/(tabs)/__tests__/_layout.test
 *
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — the tab
 * layout pulls in expo-router's native tab navigator, so we assert
 * architectural markers instead of rendering. Covers: role comes from the
 * server-derived `useIsOnboarded` hook (never a local flag — that was a
 * ship-blocking bug, see that hook's header comment), the Schedule tab is
 * hidden (not removed) for non-parents via `href: null`, and all four tabs
 * are wired.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const layoutPath = join(__dirname, '../_layout.tsx');
let layoutSource: string;

beforeAll(async () => {
  layoutSource = await Bun.file(layoutPath).text();
});

describe('TabsLayout', () => {
  it('derives role from useIsOnboarded, not a local flag', () => {
    expect(layoutSource).toContain('useIsOnboarded');
    expect(layoutSource).not.toMatch(/useSetupProgress|localRole/);
  });

  it('wires all four tab screens', () => {
    expect(layoutSource).toContain('name="home"');
    expect(layoutSource).toContain('name="schedule"');
    expect(layoutSource).toContain('name="hours"');
    expect(layoutSource).toContain('name="settings"');
  });

  it('hides the Schedule tab for non-parents via href: null rather than unmounting it', () => {
    expect(layoutSource).toMatch(
      /href:\s*isParent\s*\?\s*undefined\s*:\s*null/
    );
  });
});
