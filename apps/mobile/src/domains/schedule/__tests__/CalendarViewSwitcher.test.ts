/**
 * @module domains/schedule/__tests__/CalendarViewSwitcher.test
 * Pattern B — architectural markers for Wave E calendar switcher.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const switcherPath = join(__dirname, '../components/CalendarViewSwitcher.tsx');
const storePath = join(__dirname, '../../../store/calendarViewStore.ts');
let switcherSource: string;
let storeSource: string;

beforeAll(async () => {
  switcherSource = await Bun.file(switcherPath).text();
  storeSource = await Bun.file(storePath).text();
});

describe('CalendarViewSwitcher source', () => {
  it('exposes testIDs for each calendar view option', () => {
    expect(switcherSource).toContain('testID="calendar-view-switcher"');
    expect(switcherSource).toContain('testID={`calendar-view-${opt.id}`}');
    expect(switcherSource).toContain('CALENDAR_VIEWS.AGENDA');
    expect(switcherSource).toContain('CALENDAR_VIEWS.WEEK_RIBBON');
    expect(switcherSource).toContain('CALENDAR_VIEWS.COVERAGE_LANES');
    expect(switcherSource).toContain('CALENDAR_VIEWS.CROSS_FAMILY');
  });

  it('persists preference per role in MMKV', () => {
    expect(storeSource).toContain('calendar-view-storage');
    expect(storeSource).toContain('parentView');
    expect(storeSource).toContain('nannyView');
    expect(storeSource).toContain('createPersistedStore');
  });

  it('gates cross-family view to nanny with multiple households', () => {
    expect(switcherSource).toContain('multiHouseholdOnly');
    expect(switcherSource).toContain('nannyOnly');
    expect(switcherSource).toContain('calendarViews.${opt.id}');
  });
});
