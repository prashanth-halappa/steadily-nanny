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

  it('maps the accepted pattern status to PatternStatusIndicator, not a shift StatusPill', () => {
    expect(screenSource).toContain('PatternStatusIndicator');
    expect(screenSource).toContain('status={patternStatus()}');
    expect(screenSource).not.toContain('StatusPill');
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

  it('wires an "Adjust schedule" affordance behind canEditSchedule, alongside (not instead of) view-shifts/change-week, ONLY on the accepted branch', () => {
    // The server only accepts amend on an `accepted` pattern
    // (`PatternNotAcceptedError` otherwise) — isolate everything between the
    // accepted branch and the next status branch so this affordance can
    // never leak into declined/withdrawn.
    const acceptedStart = screenSource.indexOf("pattern.status === 'accepted'");
    const declinedStart = screenSource.indexOf(
      "pattern.status === 'declined'",
      acceptedStart
    );
    expect(acceptedStart).toBeGreaterThan(-1);
    expect(declinedStart).toBeGreaterThan(acceptedStart);
    const acceptedRegion = screenSource.slice(acceptedStart, declinedStart);

    expect(acceptedRegion).toContain('schedule-pending-view-shifts');
    expect(acceptedRegion).toContain('schedule-pending-change-week');
    expect(acceptedRegion).toContain('schedule-pending-adjust');
    expect(acceptedRegion).toContain('AdjustSchedulePatternSheet');
    expect(
      acceptedRegion.match(/canEditSchedule/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
  });

  it('drives the adjust sheet through useAmendSchedulePattern, never touching schedulePatternApi.amend directly', () => {
    expect(screenSource).toContain('useAmendSchedulePattern');
    expect(screenSource).not.toContain('schedulePatternApi');
  });

  it("passes the accepted pattern's own dtstart/until/pause_ranges into the sheet, not the wizard draft", () => {
    expect(screenSource).toContain('dtstart={pattern.dtstart}');
    expect(screenSource).toContain('until={pattern.until}');
    expect(screenSource).toContain('pauseRanges={pattern.pause_ranges}');
  });

  it('REGRESSION: amend is never a bare .mutateAsync() with no rejection handler', () => {
    expect(screenSource).not.toMatch(/void amend\.mutateAsync\(/);
    expect(screenSource).toMatch(/try\s*\{\s*await amend\.mutateAsync/);
  });

  // C5 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): no loading/error guard
  // preceded the role gate, so the household's own PARENT was told this
  // screen "isn't available to you" for as long as onboarding was still
  // resolving (role is null while loading) — mirrors ScheduleBuildScreen's
  // ordering (loading/error first, role gate second).
  it('C5: the loading/error guard precedes the role gate', () => {
    expect(screenSource).toContain('queryState(onboardingAsQuery(onboarding))');
    const loadingGuardIndex = screenSource.indexOf('onboardingQs.status');
    const roleGateIndex = screenSource.indexOf(
      'canViewParentSchedule(onboarding.role)'
    );
    expect(loadingGuardIndex).toBeGreaterThan(-1);
    expect(roleGateIndex).toBeGreaterThan(-1);
    expect(loadingGuardIndex).toBeLessThan(roleGateIndex);
  });

  it('C5: a failed onboarding read shows ErrorState with retryMemberships wired, before the role gate', () => {
    expect(screenSource).toContain("onboardingQs.status === 'error'");
    expect(screenSource).toContain('onRetry={onboardingQs.retry}');
  });

  // False alarm: `patterns.isError` fell through the same `?? []` a
  // genuinely-empty list does, so a dropped connection showed the "build a
  // new week" empty state over an existing pending/accepted week.
  it('reads patterns.isError and wires its own retry, never the empty "build a week" state on a failed read', () => {
    expect(screenSource).toContain('patterns.isError');
    expect(screenSource).toContain('patterns.refetch()');
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

  it('WS-G: the pushed usual-week detail screen has a back affordance above the title, wired to router.back()', () => {
    // The screen used to be the Schedule tab's own root (`/schedule` index),
    // which never needed its own back button — the tab bar was the way out.
    // Now it's pushed from the pattern banner
    // (`/(private)/schedule/usual-week`), one level deep, so it needs the
    // same back affordance every other pushed schedule screen has.
    expect(screenSource).toContain('testID="schedule-pending-back"');
    const returnBlock = screenSource.slice(
      screenSource.indexOf('return (\n    <ScrollView')
    );
    const backIndex = returnBlock.indexOf('testID="schedule-pending-back"');
    const titleIndex = returnBlock.indexOf("t('pending.screenTitle')");
    expect(backIndex).toBeGreaterThan(-1);
    expect(titleIndex).toBeGreaterThan(-1);
    expect(backIndex).toBeLessThan(titleIndex);
    const backButtonBlock = returnBlock.slice(backIndex, titleIndex);
    expect(backButtonBlock).toContain('onPress={() => router.back()}');
  });

  it("WS-G: the module doc no longer claims this is the '/schedule (index)' tab landing screen", () => {
    expect(screenSource).not.toContain('/schedule` (index)');
    expect(screenSource).toContain('usual-week');
  });

  // S7/S8: one section per carer, via the SAME precedence utility the other
  // five call sites use — never the household-wide
  // `.find(p => p.status !== 'ended')` this screen used to run.
  it('S7/S8: resolves ONE pattern per carer via resolvePerCarerPatterns, never a bare list-wide .find', () => {
    expect(screenSource).toContain('resolvePerCarerPatterns');
    expect(screenSource).not.toMatch(/\(patterns\.data \?\? \[\]\)\.find\(/);
  });

  it('S7: names the carer above each section, only when there is more than one', () => {
    expect(screenSource).toContain('schedule-pending-carer-name');
    expect(screenSource).toContain('showCarerLabel');
    expect(screenSource).toContain('sections.length > 1');
  });

  // S9: an ended pattern used to be excluded before this screen ever saw
  // it, so the "your usual week has ended" banner routed here to find "No
  // schedule yet" — erasing the fact that a week had ever existed.
  it("S9: 'ended' is its own PatternStatusIndicator state and CTA, not folded into the empty state", () => {
    expect(screenSource).toContain("case 'ended':\n        return 'ended';");
    expect(screenSource).toContain("pattern.status === 'ended'");
    expect(screenSource).toContain('pending.setNewWeekCta');
  });

  // S6: silence had no surface on the parent's side of the confirmation
  // flow — the detail screen read identically on day 1 and day 30.
  it('S6: shows a relative "Sent X ago" age line for a pending pattern', () => {
    expect(screenSource).toContain('relativeDaysAgo');
    expect(screenSource).toContain('schedule-pending-sent-age');
    expect(screenSource).toContain(
      "pattern.status === 'pending' && pattern.sent_at"
    );
  });

  // S7 gap: `resolvePerCarerPatterns` only ever produces a section for a
  // carer with at least one pattern row, so a second nanny with zero
  // patterns had no section at all on this screen — invisible on "Change"
  // just as she was on the tab's own banner.
  it('S7 gap fix: a patternless carer is merged into the section list via useHouseholdCarers, not silently dropped', () => {
    expect(screenSource).toContain('useHouseholdCarers');
    expect(screenSource).toContain(
      'function SchedulePendingPatternlessCarerSection'
    );
    expect(screenSource).toContain("t('pending.patternBannerNone'");
    expect(screenSource).toContain("t('pending.patternBannerBuildAction'");
    expect(screenSource).toMatch(/schedule\/build\?carerId=\$\{carerId\}/);
  });

  it('S7 gap fix: the merge is gated on at least one carer already having a section, so an all-fresh household still hits the top-level empty state', () => {
    expect(screenSource).toMatch(
      /perCarerPatterns\.length > 0\s*\n\s*\?[\s\S]{0,200}carers\.data/
    );
  });
});
