/**
 * @module domains/schedule/__tests__/AgendaView.test
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — AgendaView
 * pulls in FlashList's native-heavy internals, so we assert architectural
 * markers instead of rendering.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const viewPath = join(__dirname, '../components/AgendaView.tsx');
let viewSource: string;

beforeAll(async () => {
  viewSource = await Bun.file(viewPath).text();
});

describe('AgendaView source', () => {
  it('wires the shift list testID', () => {
    expect(viewSource).toContain('testID="schedule-shifts-list"');
  });

  it('renders parent_cover rows muted and without navigation', () => {
    expect(viewSource).toContain('shift.kind === SHIFT_KINDS.PARENT_COVER');
    expect(viewSource).toContain('accessibilityRole="text"');
    expect(viewSource).toContain('rounded-row bg-muted p-3');
    expect(viewSource).toMatch(
      /if \(isParentCover\) \{[\s\S]*return \([\s\S]*<View[\s\S]*accessibilityRole="text"/
    );
  });

  it('slots uncovered rows chronologically and uses opaque warning ground without shadow', () => {
    expect(viewSource).toContain("type: 'uncovered'");
    expect(viewSource).toContain('colors.surfaceAttention');
    expect(viewSource).toContain('useCreateParentCover');
    expect(viewSource).toContain('cover.askToCover');
    expect(viewSource).toContain('cover.hoursWrong');
  });

  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number (BUG1)', () => {
    expect(viewSource).toContain('useTabBarScrollPadding');
    expect(viewSource).toContain('paddingBottom: tabBarScrollPadding');
  });

  it('REGRESSION: extraHref uses utcIsoToWallClockHHMM for 24h start/end query params (A9)', () => {
    expect(viewSource).toMatch(
      /const extraHref = \(\(\) => \{[\s\S]*?utcIsoToWallClockHHMM\(window\.startsAt[\s\S]*?utcIsoToWallClockHHMM\(window\.endsAt/
    );
    // The two formatters must not be crossed: the URL params are machine
    // values and stay 24h, while everything the user READS goes through the
    // display formatter. These are now hoisted (`formattedStart`/`formattedEnd`)
    // so the row label, both ask buttons and the cause line cannot disagree
    // with each other — assert that fact rather than the old inline shape.
    expect(viewSource).toMatch(
      /const formattedStart = formatShiftTime\(window\.startsAt/
    );
    expect(viewSource).toMatch(
      /const formattedEnd = formatShiftTime\(window\.endsAt/
    );
    expect(viewSource).toContain('`${formattedStart}–${formattedEnd}`');
    expect(viewSource).not.toMatch(
      /start:\s*utcIsoToWallClockHHMM[\s\S]{0,80}askToCover/
    );
  });
});
