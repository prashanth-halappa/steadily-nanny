/**
 * @module domains/schedule/__tests__/CalendarViewSwitcher.test
 * Pattern B — architectural markers for Wave E calendar switcher.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  CALENDAR_VIEWS,
  resolveCalendarView,
} from '@/src/store/calendarViewStore';

const switcherPath = join(__dirname, '../components/CalendarViewSwitcher.tsx');
const storePath = join(__dirname, '../../../store/calendarViewStore.ts');
const enSchedulePath = join(
  __dirname,
  '../../../i18n/locales/en/schedule.json'
);
const esSchedulePath = join(
  __dirname,
  '../../../i18n/locales/es/schedule.json'
);
let switcherSource: string;
let storeSource: string;
let enSchedule: { calendarViews: Record<string, string> };
let esSchedule: { calendarViews: Record<string, string> };

beforeAll(async () => {
  switcherSource = await Bun.file(switcherPath).text();
  storeSource = await Bun.file(storePath).text();
  enSchedule = await Bun.file(enSchedulePath).json();
  esSchedule = await Bun.file(esSchedulePath).json();
});

describe('CalendarViewSwitcher source', () => {
  it('exposes testIDs for each calendar view option', () => {
    expect(switcherSource).toContain('testID="calendar-view-switcher"');
    expect(switcherSource).toContain('testID={`calendar-view-${opt.id}`}');
    expect(switcherSource).toContain('CALENDAR_VIEWS.AGENDA');
    expect(switcherSource).toContain('CALENDAR_VIEWS.WEEK_RIBBON');
    expect(switcherSource).not.toContain('CALENDAR_VIEWS.COVERAGE_LANES');
    expect(switcherSource).toContain('CALENDAR_VIEWS.CROSS_FAMILY');
  });

  it('does not treat coverage_lanes as a selectable calendar view', () => {
    expect(CALENDAR_VIEWS).not.toHaveProperty('COVERAGE_LANES');
    expect(Object.values(CALENDAR_VIEWS)).not.toContain('coverage_lanes');
    expect(storeSource).not.toMatch(/COVERAGE_LANES:\s*'coverage_lanes'/);
    expect(enSchedule.calendarViews).not.toHaveProperty('coverage_lanes');
    expect(esSchedule.calendarViews).not.toHaveProperty('coverage_lanes');
  });

  it('remaps legacy stored coverage_lanes to agenda', () => {
    expect(
      resolveCalendarView('parent', {
        parentView: 'coverage_lanes' as never,
        nannyView: CALENDAR_VIEWS.AGENDA,
        setView: () => undefined,
        reset: () => undefined,
      })
    ).toBe(CALENDAR_VIEWS.AGENDA);
    expect(storeSource).toContain("'coverage_lanes'");
    expect(storeSource).toContain('return CALENDAR_VIEWS.AGENDA');
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
