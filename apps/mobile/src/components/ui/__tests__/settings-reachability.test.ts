/**
 * @module components/ui/__tests__/settings-reachability
 *
 * Pattern A (docs/09-TESTING.md §5). Settings lost its tab in WP-C, so the
 * header icon is now the ONLY way in — and sign-out, delete-account and the
 * household switcher all live behind it. If a root screen drops
 * `SettingsHeaderButton`, a user standing on that screen is stranded. One
 * source assertion per screen that must carry it.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const SCREENS = {
  TodayScreen: 'domains/today/components/TodayScreen.tsx',
  InboxScreen: 'domains/inbox/components/InboxScreen.tsx',
  ScheduleShiftsScreen: 'domains/schedule/components/ScheduleShiftsScreen.tsx',
  HoursHeroBand: 'domains/timesheet/components/HoursHeroBand.tsx',
  DraftHomeScreen: 'domains/draft/components/DraftHomeScreen.tsx',
} as const;

const sources: Record<string, string> = {};

beforeAll(async () => {
  for (const [name, path] of Object.entries(SCREENS)) {
    sources[name] = await Bun.file(join(root, path)).text();
  }
});

describe('settings reachability', () => {
  for (const name of Object.keys(SCREENS)) {
    it(`${name} renders the settings header button`, () => {
      expect(sources[name]).toContain('SettingsHeaderButton');
    });
  }
});
