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
});
