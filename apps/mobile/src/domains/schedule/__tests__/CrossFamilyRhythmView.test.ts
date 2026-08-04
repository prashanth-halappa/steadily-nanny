/**
 * @module domains/schedule/__tests__/CrossFamilyRhythmView.test
 * Pattern B — CrossFamilyRhythm must never render other household.name strings.
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
    expect(viewSource).toContain('testID={`cross-family-row-${h.id}`}');
    expect(viewSource).toContain('cross-family-dot-${h.id}-${date}-${period}');
  });

  it('never renders other household names for non-active families', () => {
    expect(viewSource).not.toContain('h.name');
    expect(viewSource).not.toContain('{h.name}');
    expect(viewSource).toContain('crossFamily.thisFamily');
    expect(viewSource).toContain('crossFamily.otherFamily');
  });

  it('does not contain LEAKCANARY fixture strings', () => {
    expect(viewSource).not.toContain(LEAKCANARY);
    expect(groupingSource).not.toContain(LEAKCANARY);
  });

  it('fetches cross-household shifts via GET /me/shifts for anonymised rhythm dots', () => {
    expect(viewSource).toContain('useMeShifts');
    expect(viewSource).toContain('localDateRange(startDate, 14)');
    expect(viewSource).not.toContain('shiftApi.range');
  });

  it('REGRESSION: fetches the SAME window it renders', () => {
    // Query `from`/`to` must be derived from the same `dates` array the dots
    // read from — otherwise up to six of the fourteen rendered days can be
    // never fetched and their dots silently read as "no shifts".
    expect(viewSource).toContain('dates[0]');
    expect(viewSource).toContain('dates[13]');
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
});
