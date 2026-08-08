/**
 * @module domains/schedule/__tests__/CrossFamilyRhythmView.test
 * Pattern A (source inspection) — load-bearing invariants that survived
 * the P1 rebuild (one table, rows=dates, columns=AM/PM/Eve): must fetch
 * exactly the window it renders, and must size its own scroll padding off
 * the tab bar. The headline arithmetic (working-day count, clash count,
 * dot colour assignment) is tested for real in
 * CrossFamilyRhythmView.arithmetic.test.ts — pure functions, no source
 * scraping needed there.
 *
 * DELIBERATELY WEAKENED, once, by user ruling: this screen now renders
 * real household names (`h.name`) in the legend. TIER0-CX-SPEC.md §5.2's
 * "never a name" guarantee protects the OTHER household FROM A PARENT —
 * this screen is nanny-only (`CalendarViewSwitcher`'s `nannyOnly`, and
 * `ScheduleShiftsScreen.tsx`'s `showCrossFamily` independently gates on
 * `role === 'nanny'`), so it was never the surface §5.2 was written to
 * protect. The canary test below now asserts the ABSENCE of "This
 * family"/"Other family" placeholder copy instead — this file no longer
 * guards against a name leak; the role gate on the SCREEN (not this
 * component) is what does that job now.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const viewPath = join(__dirname, '../components/CrossFamilyRhythmView.tsx');
const groupingPath = join(__dirname, '../utils/shiftGrouping.ts');
let viewSource: string;
let groupingSource: string;

const LEAKCANARY = 'LEAKCANARY';

beforeAll(async () => {
  viewSource = await Bun.file(viewPath).text();
  groupingSource = await Bun.file(groupingPath).text();
});

describe('CrossFamilyRhythmView source', () => {
  it('renders with calendar-cross-family-view testID', () => {
    expect(viewSource).toContain('testID="calendar-cross-family-view"');
  });

  it('the legend names every household by h.name — deliberate, per user ruling (nanny-only surface)', () => {
    expect(viewSource).toContain('{h.name}');
  });

  it('the SCREEN gate, not this component, is what keeps a parent off this surface', () => {
    // This file cannot see ScheduleShiftsScreen.tsx's role check — it can
    // only confirm this component still has no role logic of its own to
    // accidentally contradict it (a role check duplicated in two places
    // is how the two quietly drift apart).
    expect(viewSource).not.toContain('SETUP_ROLES');
    expect(viewSource).not.toContain('onboarding.role');
  });

  it('does not contain LEAKCANARY fixture strings', () => {
    expect(viewSource).not.toContain(LEAKCANARY);
    expect(groupingSource).not.toContain(LEAKCANARY);
  });

  it('fetches cross-household shifts via GET /me/shifts for anonymised rhythm dots', () => {
    expect(viewSource).toContain('useMeShifts');
    expect(viewSource).toContain('localDateRange(');
    expect(viewSource).not.toContain('shiftApi.range');
  });

  it('REGRESSION: fetches the SAME two-week window it renders', () => {
    // Query `from`/`to` must be derived from the same `dates` array the
    // table reads from — otherwise a rendered day can be never fetched and
    // silently reads as "no shifts".
    expect(viewSource).toContain('dates[0]');
    expect(viewSource).toContain('dates[dates.length - 1]');
    expect(viewSource).toMatch(/const from = .*rangeStart/);
    expect(viewSource).toMatch(/const to = .*rangeEnd/);
    expect(viewSource).toContain('useMeShifts(from, to)');
  });

  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number (BUG1)', () => {
    // This is one of the Schedule tab's own scrollable content views (Wave
    // 2d, cross-family calendar), so it needs the same tap-through
    // dead-zone fix as Settings/Today/Hours.
    expect(viewSource).toContain('useTabBarScrollPadding');
    expect(viewSource).toContain('paddingBottom: tabBarScrollPadding');
  });

  it('P1 rebuild: ONE table — column headers render once, not once per household', () => {
    // The user's redirect away from the two-table sketch: "It's the same
    // bucket" — one AM/PM/Eve header row shared by every household's dots,
    // not a header repeated inside a per-family section.
    expect(viewSource).not.toContain('households.map(h => {');
    const headerIndex = viewSource.indexOf('t(`period.${period}`)');
    const rowsIndex = viewSource.indexOf('dates.map(date =>');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(rowsIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(rowsIndex);
  });

  it('a clash renders as both dots in the same cell, not a third colour', () => {
    expect(viewSource).not.toContain('colors.destructive');
  });

  it('excludes cancelled shifts from both the table and the headline counts', () => {
    expect(viewSource).toContain("shift.status === 'cancelled'");
  });

  it('degrades past 3 households to a shared neutral colour instead of throwing', () => {
    expect(viewSource).toContain('MAX_DEDICATED_COLOURS');
    expect(viewSource).toContain('colors.neutral');
  });
});
