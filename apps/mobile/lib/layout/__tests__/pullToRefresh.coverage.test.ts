/**
 * @module lib/layout/__tests__/pullToRefresh.coverage.test
 *
 * Permanent architectural coverage net: every screen that renders server data
 * must offer pull-to-refresh. Any new server-data screen added without integrating
 * `usePullToRefresh` (and wiring either `refreshControl=` or `onRefresh=`) will fail this test.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const SCREEN_PATHS = [
  'src/domains/today/components/TodayScreen.tsx',
  'src/domains/inbox/components/InboxScreen.tsx',
  'src/domains/draft/components/DraftHomeScreen.tsx',
  'src/domains/timesheet/components/HoursScreen.tsx',
  'src/domains/timesheet/components/ParentWeekView.tsx',
  'src/domains/timesheet/components/NannyWeekView.tsx',
  'src/domains/timesheet/components/PaymentsScreen.tsx',
  'src/domains/household/components/ThisFamilyScreen.tsx',
  'src/domains/household/components/CarerProfileScreen.tsx',
  'src/domains/schedule/components/AgendaView.tsx',
  'src/domains/schedule/components/WeekRibbonView.tsx',
  'src/domains/schedule/components/CrossFamilyRhythmView.tsx',
  'src/domains/schedule/components/ShiftDetailScreen.tsx',
  'src/domains/schedule/components/SchedulePendingScreen.tsx',
  'src/domains/pay/components/MyPayScreen.tsx',
  'src/domains/pay/components/PayArrangementScreen.tsx',
  'src/domains/pay/components/ProposalReviewScreen.tsx',
  'src/app/(private)/(tabs)/settings.tsx',
  'src/app/(private)/settings/carer-availability.tsx',
  'src/app/(private)/settings/household-time-off.tsx',
  'src/domains/timeOff/components/TimeOffScreen.tsx',
  'src/domains/householdClosures/components/HouseholdClosuresScreen.tsx',
] as const;

const sources = new Map<string, string>();

beforeAll(async () => {
  for (const relativePath of SCREEN_PATHS) {
    const fullPath = join(__dirname, '../../../', relativePath);
    const content = await Bun.file(fullPath).text();
    sources.set(relativePath, content);
  }
});

describe('Pull-to-refresh screen coverage', () => {
  for (const relativePath of SCREEN_PATHS) {
    it(`screen ${relativePath} integrates usePullToRefresh`, () => {
      const source = sources.get(relativePath) ?? '';
      expect(source).toContain('usePullToRefresh');
      const hasRefreshProp =
        source.includes('refreshControl=') || source.includes('onRefresh=');
      expect(hasRefreshProp).toBe(true);
    });
  }
});
