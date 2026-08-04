/**
 * @module domains/schedule/__tests__/SchedulePendingScreen.test
 *
 * Source-inspection test for SchedulePendingScreen (Pattern A,
 * docs/09-TESTING.md §5) — the screen uses `AlertDialog` (from
 * `@rn-primitives/alert-dialog`), which is not mocked in the global preload
 * (`apps/mobile/bun.setup.ts`), so we assert architectural markers instead of
 * rendering. Mirrors `apps/mobile/src/app/(private)/(tabs)/__tests__/settings.test.tsx`,
 * the precedent for AlertDialog-using screens.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/SchedulePendingScreen.tsx');
let screenSource: string;

beforeAll(async () => {
  screenSource = await Bun.file(screenPath).text();
});

describe('SchedulePendingScreen', () => {
  it('exports the screen', () => {
    expect(screenSource).toContain('export function SchedulePendingScreen');
  });

  it('reads pattern state from the data-layer hooks', () => {
    expect(screenSource).toContain('useSchedulePatterns');
    expect(screenSource).toContain('useWithdrawSchedulePattern');
    expect(screenSource).toContain('useIsOnboarded');
  });

  it('wires the always-present screen root testID', () => {
    expect(screenSource).toContain('schedule-pending-screen');
  });

  it('wires the empty-state testIDs', () => {
    expect(screenSource).toContain('schedule-pending-empty');
    expect(screenSource).toContain('schedule-pending-build-cta');
  });

  it('wires the withdraw flow testIDs', () => {
    expect(screenSource).toContain('schedule-pending-withdraw');
    expect(screenSource).toContain('schedule-pending-withdraw-confirm');
  });

  it('wires the accepted-state view-shifts testID', () => {
    expect(screenSource).toContain('schedule-pending-view-shifts');
  });

  it('renders a recurrence-as-rule subject line under the status pill and named Accepted bridge', () => {
    expect(screenSource).toContain('schedule-pending-subject');
    expect(screenSource).toContain('pending.subjectLine');
    expect(screenSource).toContain('parseWeeklyRruleInterval');
    expect(screenSource).toContain('formatDisplayDate');
    expect(screenSource).not.toContain('formatWeekRangeLabel');
    expect(screenSource).not.toContain('getWeekDates');
    expect(screenSource).toContain('pending.acceptedMeansShifts');
    expect(screenSource).toContain('resolveMemberDisplayName');
    expect(screenSource).toContain('schedule-pending-accepted-bridge');
  });

  it('confirms withdrawal via AlertDialog, never a bare RN Modal (GOLDEN-FIX #1)', () => {
    expect(screenSource).toContain('AlertDialog');
    expect(screenSource).not.toMatch(/<Modal\b/);
  });

  it('maps the accepted pattern status to the confirmed StatusPill variant', () => {
    const acceptedIndex = screenSource.indexOf("'accepted'");
    const confirmedIndex = screenSource.indexOf("'confirmed'");
    expect(acceptedIndex).toBeGreaterThan(-1);
    expect(confirmedIndex).toBeGreaterThan(-1);
  });

  it('REGRESSION: withdraw is never a bare .mutateAsync() with no rejection handler', () => {
    // `void withdraw.mutateAsync()` discards the promise without a
    // `.catch()` — `void` only suppresses a lint warning, it does not
    // attach a rejection handler, so a failed withdraw would surface as an
    // unhandled promise rejection (the same defect class as D7's clock-in
    // double-tap bug) even though `onError` still shows a toast.
    expect(screenSource).not.toMatch(/void withdraw\.mutateAsync\(\)/);
    expect(screenSource).toMatch(/try\s*\{\s*await withdraw\.mutateAsync/);
  });

  it('REGRESSION: the accepted state offers a way to change the week, alongside (not instead of) viewing shifts', () => {
    // The bug: once a pattern is `accepted`, the only rendered action was
    // "View shifts" — there was no way back into the build wizard, so the
    // app went permanently read-only after one accepted week. Isolate the
    // whole `pattern.status === 'accepted'` branch and assert it renders
    // BOTH the existing view-shifts action AND a new "change the week"
    // action, not a replacement of one by the other.
    const acceptedBranchMatch = screenSource.match(
      /pattern\.status === 'accepted'[\s\S]{0,1400}?\) : null}/
    );
    expect(acceptedBranchMatch).not.toBeNull();
    const acceptedBranch = acceptedBranchMatch?.[0] ?? '';
    expect(acceptedBranch).toContain('schedule-pending-view-shifts');
    expect(acceptedBranch).toContain('schedule-pending-change-week');
    expect(acceptedBranch).toMatch(/BUILD_HREF/);
  });

  it('passes until/exdates/pause_ranges into SchedulePatternPreview', () => {
    expect(screenSource).toContain('until={pattern.until}');
    expect(screenSource).toContain('exdates={pattern.exdates}');
    expect(screenSource).toContain('pauseRanges={pattern.pause_ranges}');
  });

  it('REGRESSION: a non-parent/helper role sees an honest not-available state with a back affordance, never a bare null', () => {
    // The bug: `if (!canViewParentSchedule(onboarding.role)) { return null; }`
    // left a deep-linked nanny staring at a blank screen — no message, no
    // back affordance, nothing.
    expect(screenSource).not.toMatch(
      /if \(!canViewParentSchedule\(onboarding\.role\)\) \{\s*return null;\s*\}/
    );
    expect(screenSource).toContain('testID="schedule-pending-not-available"');
    expect(screenSource).toContain(
      'testID="schedule-pending-not-available-back"'
    );
    expect(screenSource).toContain("t('pending.notAvailableTitle')");
    expect(screenSource).toContain("t('pending.notAvailableDescription')");
  });

  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number (BUG1)', () => {
    expect(screenSource).toContain('useTabBarScrollPadding');
    expect(screenSource).toContain('paddingBottom: tabBarScrollPadding');
  });
});
