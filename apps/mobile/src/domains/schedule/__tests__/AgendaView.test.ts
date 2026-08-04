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

  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number (BUG1)', () => {
    // This is the default Schedule tab content view (Agenda calendar),
    // so it needs the same tap-through dead-zone fix as
    // Settings/Today/Hours: the floating tab bar overlays this screen's
    // content instead of reserving its own layout space.
    expect(viewSource).toContain('useTabBarScrollPadding');
    expect(viewSource).toContain('paddingBottom: tabBarScrollPadding');
  });
});
