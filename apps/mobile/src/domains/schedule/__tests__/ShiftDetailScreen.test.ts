/**
 * @module domains/schedule/__tests__/ShiftDetailScreen.test
 * Pattern A — architectural markers for D23/D24 shift detail.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const screenPath = join(__dirname, '../components/ShiftDetailScreen.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(screenPath).text();
});

describe('ShiftDetailScreen source', () => {
  it('loads the shift and shift-scoped events hooks', () => {
    expect(source).toContain('useShift');
    expect(source).toContain('useShiftEvents');
    expect(source).toContain('useUpdateShift');
  });

  it('gates edit UI on parent role', () => {
    expect(source).toContain('SETUP_ROLES.PARENT');
    expect(source).toContain('shift-detail-edit');
    expect(source).toContain('shift-detail-readonly');
  });

  it('converts wall-clock times through wallClockToUtcIso', () => {
    expect(source).toContain('wallClockToUtcIso');
    expect(source).toContain('utcIsoToWallClockHHMM');
  });

  it('renders a known-type fallback for unknown event types', () => {
    expect(source).toContain('detail.eventTypeUnknown');
    expect(source).toContain('detail.eventTypeFallback');
  });
});
