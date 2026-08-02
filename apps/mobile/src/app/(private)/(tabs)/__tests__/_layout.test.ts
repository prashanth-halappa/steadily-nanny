/**
 * @module app/(private)/(tabs)/__tests__/_layout.test
 *
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — the tab
 * layout pulls in expo-router's native tab navigator, so we assert
 * architectural markers instead of rendering. Covers: all four tabs are
 * wired, the Schedule tab is visible for every role (no href gate), and
 * tab titles are localized via common:tabs.*.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const layoutPath = join(__dirname, '../_layout.tsx');
let layoutSource: string;

beforeAll(async () => {
  layoutSource = await Bun.file(layoutPath).text();
});

describe('TabsLayout', () => {
  it('wires all four tab screens', () => {
    expect(layoutSource).toContain('name="home"');
    expect(layoutSource).toContain('name="schedule"');
    expect(layoutSource).toContain('name="hours"');
    expect(layoutSource).toContain('name="settings"');
  });

  it('does not hide the Schedule tab via href: null (role fork lives in schedule.tsx)', () => {
    expect(layoutSource).not.toMatch(/href:/);
    expect(layoutSource).not.toContain('canViewParentSchedule');
  });

  it('localizes tab titles via common:tabs.* keys', () => {
    expect(layoutSource).toContain("useTranslation('common')");
    expect(layoutSource).toContain("t('tabs.today')");
    expect(layoutSource).toContain("t('tabs.schedule')");
    expect(layoutSource).toContain("t('tabs.hours')");
    expect(layoutSource).toContain("t('tabs.settings')");
  });
});
