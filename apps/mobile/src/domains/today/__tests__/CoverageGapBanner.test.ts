/**
 * @module domains/today/__tests__/CoverageGapBanner.test
 * Pattern B — coverage gap banner on TodayScreen (Wave D).
 *
 * Wave 2 T1-arbitration audit: gap-fetching moved into `useTodayCoverageGaps`
 * so `TodayScreen` can ask "is there a gap today" without a second query —
 * the architectural markers this file pinned on the component now live
 * there instead.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const bannerPath = join(__dirname, '../components/CoverageGapBanner.tsx');
const hookPath = join(__dirname, '../hooks/useTodayCoverageGaps.ts');
const todayPath = join(__dirname, '../components/TodayScreen.tsx');
let bannerSource: string;
let hookSource: string;
let todaySource: string;

beforeAll(async () => {
  bannerSource = await Bun.file(bannerPath).text();
  hookSource = await Bun.file(hookPath).text();
  todaySource = await Bun.file(todayPath).text();
});

describe('CoverageGapBanner source', () => {
  it('uses useDayThread and filters coverage_gap events', () => {
    expect(hookSource).toContain('useDayThread');
    expect(hookSource).toContain("event_type === 'coverage_gap'");
    expect(bannerSource).toContain('testID="coverage-gap-banner"');
    expect(bannerSource).toContain('testID={`coverage-gap-item-${gap.id}`}');
    expect(bannerSource).toContain('coverageGap.title');
    expect(bannerSource).toContain('coverageGap.description');
  });

  it('is mounted on TodayScreen', () => {
    expect(todaySource).toContain('CoverageGapBanner');
  });

  // Wave 2-E: `bg-warning/15` + `rounded-lg` was right in spirit (a tinted
  // attention surface) and wrong in execution (a translucent ground under
  // a shadow — GOLDEN-FIXES #19 — and the wrong radius). Opaque `Card
  // tone="attention"` is the real T1/attention surface.
  it('uses an opaque Card tone="attention", not a translucent View', () => {
    expect(bannerSource).toContain("tone={demoted ? 'default' : 'attention'}");
    expect(bannerSource).not.toContain('bg-warning/15');
    expect(bannerSource).not.toContain('rounded-lg');
  });

  // Rule B: sentence text on `surfaceAttention` is `foreground`, never
  // `warningStrong`/`warning` — those measure under AA there.
  it('does not colour sentence text warning/warningStrong on the tinted ground', () => {
    expect(bannerSource).not.toContain('text-warning');
  });

  // T1 arbitration audit: a third independent attention trigger with no
  // `demoted` escape hatch is exactly the bug that shipped — pin the prop.
  it('accepts a demoted prop so TodayScreen can arbitrate one T1 per screen', () => {
    expect(bannerSource).toContain('demoted');
  });
});
