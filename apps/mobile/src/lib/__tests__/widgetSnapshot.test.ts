/**
 * @module lib/__tests__/widgetSnapshot.test
 *
 * The widget builders are pure and every user-visible string is decided here,
 * so this is the layer worth testing: the `'widget'` components themselves
 * render inside WidgetKit and cannot run under bun.
 *
 * Clock times are asserted with a hour-cycle-tolerant matcher — the builders
 * deliberately format times in the DEVICE's 12/24h preference (GOLDEN-FIXES
 * #22), so pinning "08:12" would only assert the CI box's locale.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import type { TimeEntry } from '@/src/domains/timesheet/types';
import i18n from '@/src/i18n';
import {
  ARRIVING_WINDOW_MS,
  applyWidgetSnapshots,
  buildNannyWeekPayload,
  buildNextShiftPayload,
  buildParentWeekPayload,
  buildRedirectPayload,
  buildTodaysCoverPayload,
  type CoverShiftInput,
  formatNameList,
  type NannyShiftInput,
  registerWidgetTargets,
  resetWidgetTargets,
  SNAPSHOT_AS_OF_MS,
  SNAPSHOT_DEGRADE_MS,
  widgetSafeProps,
} from '../widgetSnapshot';
import type { NextShiftWidgetProps } from '../widgetSnapshot.types';

const ZONE = 'Europe/London';
/** 2026-08-06 is a Thursday; 08:00 London == 07:00Z in August (BST). */
const NOW = new Date('2026-08-06T09:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;

/** Matches "08:12" and "8:12 AM" alike — see the module header. */
function expectTime(actual: string | null, hhmm: string): void {
  const [hours, minutes] = hhmm.split(':');
  const twelve = String(Number(hours) % 12 || 12);
  expect(actual).toMatch(new RegExp(`(${hours}|${twelve}):${minutes}`));
}

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: 'hh-1',
    carer_id: 'carer-1',
    carer_display_name: 'Sarah',
    shift_id: null,
    clock_in_at: '2026-08-06T07:12:00.000Z',
    clock_out_at: null,
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'running',
    local_date: '2026-08-06',
    timezone: ZONE,
    created_at: '2026-08-06T07:12:00.000Z',
    updated_at: '2026-08-06T07:12:00.000Z',
    ...overrides,
  };
}

function makeNannyShift(
  overrides: Partial<NannyShiftInput> = {}
): NannyShiftInput {
  return {
    id: 'shift-1',
    startsAt: '2026-08-07T07:00:00.000Z',
    endsAt: '2026-08-07T16:00:00.000Z',
    householdName: 'Patel household',
    timeZone: ZONE,
    childNames: ['Mia', 'Jonah'],
    needsResponse: false,
    ...overrides,
  };
}

function makeCoverShift(
  overrides: Partial<CoverShiftInput> = {}
): CoverShiftInput {
  return {
    id: 'shift-1',
    carerId: 'carer-1',
    startsAt: '2026-08-06T07:00:00.000Z',
    endsAt: '2026-08-06T16:00:00.000Z',
    localDate: '2026-08-06',
    status: 'confirmed',
    childNames: ['Mia', 'Jonah'],
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
  resetWidgetTargets();
});

describe('staleness thresholds', () => {
  // The widget components compute their own degrade from `generatedAtIso`,
  // so these two numbers are the contract between the two halves. Pinning
  // them makes a silent edit on either side fail here rather than on a
  // lock screen.
  it('degrades clock-derived claims to schedule truth at 45 minutes', () => {
    expect(SNAPSHOT_DEGRADE_MS).toBe(45 * 60 * 1000);
  });

  it('shows the "As of" footer at 2 hours', () => {
    expect(SNAPSHOT_AS_OF_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('opens the arriving window 60 minutes before a shift', () => {
    expect(ARRIVING_WINDOW_MS).toBe(60 * 60 * 1000);
  });

  it('stamps every payload with the instant it was built', () => {
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [],
    });
    expect(props.generatedAtIso).toBe(new Date(NOW).toISOString());
    expectTime(props.asOfLabel, '10:00');
  });
});

describe('formatNameList', () => {
  it('joins two English names with an ampersand', () => {
    expect(formatNameList(['Mia', 'Jonah'])).toBe('Mia & Jonah');
  });

  it('returns a single name unchanged', () => {
    expect(formatNameList(['Mia'])).toBe('Mia');
  });

  it('returns an empty string when there are no names', () => {
    expect(formatNameList([])).toBe('');
  });

  it('drops blank names rather than emitting a dangling separator', () => {
    expect(formatNameList(['Mia', '  ', 'Jonah'])).toBe('Mia & Jonah');
  });

  it('comma-separates three or more names', () => {
    expect(formatNameList(['Mia', 'Jonah', 'Ada'])).toBe('Mia, Jonah & Ada');
  });

  describe('Spanish', () => {
    beforeAll(async () => {
      await i18n.changeLanguage('es');
    });
    afterAll(async () => {
      await i18n.changeLanguage('en');
    });

    it('joins with "y"', () => {
      expect(formatNameList(['Mia', 'Jonah'])).toBe('Mia y Jonah');
    });

    // CLDR's Spanish list pattern always says "y", which is why this is
    // hand-rolled instead of `Intl.ListFormat`.
    it('switches to "e" before a name starting with an i-sound', () => {
      expect(formatNameList(['Ada', 'Iris'])).toBe('Ada e Iris');
      expect(formatNameList(['Ada', 'Inés'])).toBe('Ada e Inés');
      expect(formatNameList(['Ada', 'Hilda'])).toBe('Ada e Hilda');
    });

    it('keeps "y" before the "hie" diphthong, which is not an i-sound', () => {
      expect(formatNameList(['Ada', 'Hierro'])).toBe('Ada y Hierro');
    });
  });
});

describe('buildNextShiftPayload (N2)', () => {
  it('says "open the app" when nothing has ever synced', () => {
    const { props, timeline } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: false,
      running: null,
      shifts: [makeNannyShift()],
    });
    expect(props.state.kind).toBe('neverSynced');
    expect(timeline).toHaveLength(0);
  });

  it('says there are no shifts when synced with an empty schedule', () => {
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [],
    });
    expect(props.state).toEqual({
      kind: 'empty',
      title: 'Next shift',
      body: 'No shifts in the next two weeks',
    });
  });

  it('summarises the on-clock state without repeating the Live Activity figures', () => {
    const { props, timeline } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: {
        clockInAt: '2026-08-06T07:12:00.000Z',
        householdName: 'Patel household',
        timeZone: ZONE,
      },
      shifts: [makeNannyShift()],
    });
    if (props.state.kind !== 'onClock') throw new Error('expected onClock');
    expect(props.state.title).toBe('On the clock');
    expectTime(props.state.detail, '08:12');
    expect(props.state.householdName).toBe('Patel household');
    // Clock-derived — only a fresh snapshot may move it.
    expect(timeline).toHaveLength(0);
  });

  it('lists the next two shifts with the household name always present', () => {
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          id: 'b',
          startsAt: '2026-08-10T07:00:00.000Z',
          endsAt: '2026-08-10T16:00:00.000Z',
          householdName: 'Okafor household',
          childNames: [],
        }),
        makeNannyShift({ id: 'a' }),
        makeNannyShift({
          id: 'c',
          startsAt: '2026-08-12T07:00:00.000Z',
          endsAt: '2026-08-12T16:00:00.000Z',
          householdName: 'Third household',
        }),
      ],
    });
    if (props.state.kind !== 'nextShift') throw new Error('expected nextShift');
    expect(props.state.rows).toHaveLength(2);
    expect(props.state.rows[0]?.dayLabel).toBe('Tomorrow');
    expect(props.state.rows[0]?.householdName).toBe('Patel household');
    expect(props.state.rows[0]?.childrenLine).toBe('Mia & Jonah');
    // Multi-household: the second row keeps ITS OWN household name — dropping
    // it is the wrong-door risk the plan calls out.
    expect(props.state.rows[1]?.householdName).toBe('Okafor household');
    expect(props.state.rows[1]?.childrenLine).toBeNull();
  });

  it('labels a shift later today as "Today"', () => {
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          startsAt: '2026-08-06T16:00:00.000Z',
          endsAt: '2026-08-06T19:00:00.000Z',
        }),
      ],
    });
    if (props.state.kind !== 'nextShift') throw new Error('expected nextShift');
    expect(props.state.rows[0]?.dayLabel).toBe('Today');
  });

  it('flips to "starting soon" inside the 60-minute arriving window', () => {
    const startsAt = new Date(NOW + 30 * 60 * 1000).toISOString();
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          startsAt,
          endsAt: new Date(NOW + 8 * HOUR).toISOString(),
        }),
      ],
    });
    if (props.state.kind !== 'startingSoon') {
      throw new Error('expected startingSoon');
    }
    expect(props.state.title).toBe('Starting soon');
    expect(props.state.householdName).toBe('Patel household');
  });

  it('nudges rather than accuses once a shift has started', () => {
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          startsAt: new Date(NOW - HOUR).toISOString(),
          endsAt: new Date(NOW + 6 * HOUR).toISOString(),
        }),
      ],
    });
    if (props.state.kind !== 'shiftStarted') {
      throw new Error('expected shiftStarted');
    }
    expect(props.state.title).toBe('Shift started');
    expect(props.state.body).toBe('Tap to clock in');
    // Never the word "Late" — the snapshot cannot verify she isn't clocked in.
    expect(`${props.state.title} ${props.state.body}`).not.toMatch(/late/i);
  });

  it('expires the started state into schedule truth at ends_at', () => {
    const { props } = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          id: 'over',
          startsAt: new Date(NOW - 9 * HOUR).toISOString(),
          endsAt: new Date(NOW - HOUR).toISOString(),
        }),
      ],
    });
    // The finished shift is gone entirely — the widget never asserts a
    // missed shift after the fact.
    expect(props.state.kind).toBe('empty');
  });

  describe('timeline', () => {
    const startsAt = new Date(NOW + 3 * HOUR).toISOString();
    const endsAt = new Date(NOW + 11 * HOUR).toISOString();
    const payload = () =>
      buildNextShiftPayload({
        nowMs: NOW,
        timeZone: ZONE,
        synced: true,
        running: null,
        shifts: [makeNannyShift({ startsAt, endsAt })],
      });

    it('schedules entries at start−60m, start and end', () => {
      const { timeline } = payload();
      expect(timeline.map(entry => entry.dateIso)).toEqual([
        new Date(NOW + 2 * HOUR).toISOString(),
        startsAt,
        endsAt,
      ]);
    });

    it('renders the right state at each instant without reopening the app', () => {
      const { timeline } = payload();
      expect(timeline[0]?.props.state.kind).toBe('startingSoon');
      expect(timeline[1]?.props.state.kind).toBe('shiftStarted');
      expect(timeline[2]?.props.state.kind).toBe('empty');
    });

    it('never schedules an entry in the past', () => {
      const { timeline } = buildNextShiftPayload({
        nowMs: NOW,
        timeZone: ZONE,
        synced: true,
        running: null,
        shifts: [
          makeNannyShift({
            startsAt: new Date(NOW - HOUR).toISOString(),
            endsAt: new Date(NOW + 6 * HOUR).toISOString(),
          }),
        ],
      });
      expect(timeline.map(entry => entry.dateIso)).toEqual([
        new Date(NOW + 6 * HOUR).toISOString(),
      ]);
    });
  });

  describe('pending-response banner', () => {
    it('surfaces the soonest shift awaiting her acceptance', () => {
      const { props } = buildNextShiftPayload({
        nowMs: NOW,
        timeZone: ZONE,
        synced: true,
        running: null,
        shifts: [
          makeNannyShift({ id: 'confirmed' }),
          makeNannyShift({
            id: 'pending-1',
            startsAt: '2026-08-13T07:00:00.000Z',
            endsAt: '2026-08-13T16:00:00.000Z',
            needsResponse: true,
          }),
        ],
      });
      expect(props.pending?.label).toBe('Needs your response');
      expect(props.pending?.detail).toMatch(/^Thu /);
      expect(props.pending?.deepLink).toMatch(/schedule\/shifts\/pending-1$/);
    });

    it('still shows while she is on the clock', () => {
      const { props } = buildNextShiftPayload({
        nowMs: NOW,
        timeZone: ZONE,
        synced: true,
        running: {
          clockInAt: '2026-08-06T07:12:00.000Z',
          householdName: 'Patel household',
          timeZone: ZONE,
        },
        shifts: [makeNannyShift({ needsResponse: true })],
      });
      expect(props.pending).not.toBeNull();
    });

    it('is null when nothing needs a response', () => {
      const { props } = buildNextShiftPayload({
        nowMs: NOW,
        timeZone: ZONE,
        synced: true,
        running: null,
        shifts: [makeNannyShift()],
      });
      expect(props.pending).toBeNull();
    });
  });
});

describe('buildTodaysCoverPayload (P1)', () => {
  const base = {
    nowMs: NOW,
    timeZone: ZONE,
    householdName: 'Patel household',
    namesByCarerId: { 'carer-1': 'Sarah', 'carer-2': 'Bea' },
    gaps: [],
  };

  it('names the children a live carer is with', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [makeEntry({ shift_id: 'shift-1' })],
      shifts: [makeCoverShift()],
    });
    const row = props.rows[0];
    expect(row?.kind).toBe('live');
    expect(row?.title).toBe('Sarah is with Mia & Jonah');
    expectTime(row?.detail ?? null, '08:12');
    expect(row?.isLiveDot).toBe(true);
  });

  it('falls back to "is here" when the shift has no children', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [makeEntry({ shift_id: 'shift-1' })],
      shifts: [makeCoverShift({ childNames: [] })],
    });
    expect(props.rows[0]?.title).toBe('Sarah is here');
  });

  it('degrades a live row to schedule truth for a stale snapshot', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [makeEntry({ shift_id: 'shift-1' })],
      shifts: [makeCoverShift()],
    });
    const row = props.rows[0];
    // The widget swaps these in past SNAPSHOT_DEGRADE_MS: no dot, "due"
    // wording, no clock-derived claim.
    expect(row?.staleTitle).toMatch(/^Sarah · due /);
    expect(row?.staleDetail).toBeNull();
  });

  it('reports a finished carer with her hours for today only', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [
        makeEntry({
          status: 'submitted',
          clock_in_at: '2026-08-06T07:12:00.000Z',
          clock_out_at: '2026-08-06T16:04:00.000Z',
          break_minutes: 30,
        }),
        // Yesterday's entry for the same carer must not inflate the total.
        makeEntry({
          id: 'entry-old',
          status: 'submitted',
          local_date: '2026-08-05',
          clock_in_at: '2026-08-05T07:00:00.000Z',
          clock_out_at: '2026-08-05T16:00:00.000Z',
        }),
      ],
      shifts: [],
    });
    const row = props.rows[0];
    expect(row?.kind).toBe('finished');
    expect(row?.title).toMatch(/^Sarah finished at /);
    expect(row?.detail).toBe('8h 22m');
    expect(row?.isLiveDot).toBe(false);
  });

  it('ranks rows live, finished, arriving, scheduled, gap', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      namesByCarerId: {
        'carer-1': 'Sarah',
        'carer-2': 'Bea',
        'carer-3': 'Ann',
        'carer-4': 'Zoe',
      },
      entries: [
        makeEntry({ id: 'e-live', carer_id: 'carer-1', shift_id: 'shift-1' }),
        makeEntry({
          id: 'e-done',
          carer_id: 'carer-2',
          carer_display_name: 'Bea',
          status: 'submitted',
          clock_in_at: '2026-08-06T05:00:00.000Z',
          clock_out_at: '2026-08-06T08:00:00.000Z',
        }),
      ],
      shifts: [
        makeCoverShift(),
        makeCoverShift({
          id: 'shift-3',
          carerId: 'carer-3',
          startsAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
          endsAt: new Date(NOW + 6 * HOUR).toISOString(),
        }),
        makeCoverShift({
          id: 'shift-4',
          carerId: 'carer-4',
          startsAt: new Date(NOW + 5 * HOUR).toISOString(),
          endsAt: new Date(NOW + 9 * HOUR).toISOString(),
        }),
      ],
      gaps: [
        {
          startsAt: '2026-08-06T14:00:00.000Z',
          endsAt: '2026-08-06T17:00:00.000Z',
        },
      ],
    });
    expect(props.rows.map(row => row.kind)).toEqual([
      'live',
      'finished',
      'arriving',
      'scheduled',
      'gap',
    ]);
    expect(props.rows[2]?.title).toMatch(/^Ann arrives at /);
    expect(props.rows[3]?.title).toMatch(/^Zoe · due /);
    expect(props.rows[4]?.title).toMatch(/^No one booked /);
    expect(props.moreLabel).toBe('+4 more');
  });

  it('sorts carers of the same kind by name, so rows do not jump', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      namesByCarerId: { 'carer-1': 'Zoe', 'carer-2': 'Ann' },
      entries: [
        makeEntry({ id: 'z', carer_id: 'carer-1', carer_display_name: 'Zoe' }),
        makeEntry({ id: 'a', carer_id: 'carer-2', carer_display_name: 'Ann' }),
      ],
      shifts: [],
    });
    expect(props.rows.map(row => row.title)).toEqual([
      'Ann is here',
      'Zoe is here',
    ]);
  });

  it('lets a carer own entries suppress her own scheduled row', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [makeEntry({ shift_id: 'shift-1' })],
      shifts: [makeCoverShift()],
    });
    expect(props.rows).toHaveLength(1);
    expect(props.moreLabel).toBeNull();
  });

  it('drops cancelled shifts and shifts from another day', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [],
      shifts: [
        makeCoverShift({ id: 'x', status: 'cancelled' }),
        makeCoverShift({ id: 'y', localDate: '2026-08-07' }),
      ],
    });
    expect(props.rows).toHaveLength(0);
  });

  it('never mentions overdue or a missing clock-out', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      // Running long past the scheduled finish — private to the nanny.
      entries: [makeEntry({ clock_in_at: '2026-08-05T07:00:00.000Z' })],
      shifts: [makeCoverShift()],
    });
    const text = JSON.stringify(props);
    expect(text).not.toMatch(/overdue|still working|hasn't clocked out/i);
  });

  it('carries the household name even for a single household', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [],
      shifts: [],
    });
    expect(props.householdName).toBe('Patel household');
    expect(props.emptyTitle).toBe('No one booked today');
  });
});

describe('buildTodaysCoverPayload departed carers (058 has no shift snapshot)', () => {
  const base = {
    nowMs: NOW,
    timeZone: ZONE,
    householdName: 'Patel household',
    namesByCarerId: { 'carer-1': 'Sarah' },
    gaps: [],
  };

  it("does not sibling a departed carer's own shift onto her entry row", () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [
        makeEntry({
          carer_id: null,
          carer_display_name: 'Emma',
          shift_id: 'shift-emma-1122',
          status: 'submitted',
          clock_in_at: '2026-08-06T07:12:00.000Z',
          clock_out_at: '2026-08-06T16:04:00.000Z',
        }),
      ],
      shifts: [
        makeCoverShift({
          id: 'shift-emma-1122',
          carerId: null,
          status: 'confirmed',
        }),
      ],
    });
    expect(props.rows).toHaveLength(1);
    expect(props.rows[0]?.kind).toBe('finished');
    expect(props.rows[0]?.title).toMatch(/^Emma finished at /);
  });

  it('keeps two departed carers on separate rows instead of merging under "unassigned"', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [],
      shifts: [
        makeCoverShift({
          id: 'shift-departed-a',
          carerId: null,
          status: 'confirmed',
          startsAt: '2026-08-06T09:00:00.000Z',
          endsAt: '2026-08-06T17:00:00.000Z',
        }),
        makeCoverShift({
          id: 'shift-departed-b',
          carerId: null,
          status: 'confirmed',
          startsAt: '2026-08-06T13:00:00.000Z',
          endsAt: '2026-08-06T21:00:00.000Z',
        }),
      ],
    });
    expect(props.rows).toHaveLength(2);
    expect(new Set(props.rows.map(row => row.key)).size).toBe(2);
  });
});

describe('week hours widgets (N3 / P2)', () => {
  const workedWeek = [
    makeEntry({
      id: 'w1',
      status: 'submitted',
      clock_in_at: '2026-08-03T07:00:00.000Z',
      clock_out_at: '2026-08-03T16:00:00.000Z',
      scheduled_minutes: 480,
      local_date: '2026-08-03',
    }),
    makeEntry({
      id: 'w2',
      status: 'submitted',
      clock_in_at: '2026-08-04T07:00:00.000Z',
      clock_out_at: '2026-08-04T15:15:00.000Z',
      scheduled_minutes: 480,
      local_date: '2026-08-04',
    }),
  ];
  const base = {
    nowMs: NOW,
    timeZone: ZONE,
    householdName: 'Patel household',
    entries: workedWeek,
  };

  it('totals the worked hours against what was scheduled', () => {
    const { props } = buildNannyWeekPayload({ ...base, timesheet: null });
    expect(props.hours).toBe('17h 15m');
    expect(props.scheduledLine).toBe('of 16h scheduled');
    expect(props.statusLabel).toBe('Hours still coming in');
  });

  it('says nothing about scheduled hours when no entry carries a booking', () => {
    const { props } = buildNannyWeekPayload({
      ...base,
      entries: [
        makeEntry({
          status: 'submitted',
          clock_out_at: '2026-08-06T16:00:00.000Z',
        }),
      ],
      timesheet: null,
    });
    expect(props.scheduledLine).toBeNull();
  });

  it('ages a submitted week so she can see how long it has waited', () => {
    const { props } = buildNannyWeekPayload({
      ...base,
      timesheet: {
        status: 'submitted',
        total_minutes: 1035,
        updated_at: '2026-08-02T18:00:00.000Z',
        approved_at: null,
      },
    });
    // Sunday 18:00Z → Thursday 09:00Z is 3.6 days; floored, never rounded up,
    // so the widget can't claim a week has waited longer than it has.
    expect(props.statusLabel).toBe('Sent Sunday · awaiting approval · 3 days');
  });

  it('says "today" rather than "0 days" for a week just sent', () => {
    const { props } = buildNannyWeekPayload({
      ...base,
      timesheet: {
        status: 'submitted',
        total_minutes: 1035,
        updated_at: new Date(NOW - HOUR).toISOString(),
        approved_at: null,
      },
    });
    expect(props.statusLabel).toMatch(/awaiting approval · today$/);
  });

  it('flags a week that came back changed', () => {
    const { props } = buildNannyWeekPayload({
      ...base,
      timesheet: {
        status: 'approved',
        total_minutes: 975,
        updated_at: '2026-08-05T18:00:00.000Z',
        approved_at: '2026-08-05T18:00:00.000Z',
      },
    });
    expect(props.statusLabel).toBe('Approved');
    expect(props.adjustmentNote).toBe('17h 15m submitted → 16h 15m approved');
  });

  it('stays quiet when the approved total matches what she submitted', () => {
    const { props } = buildNannyWeekPayload({
      ...base,
      timesheet: {
        status: 'approved',
        total_minutes: 1035,
        updated_at: '2026-08-05T18:00:00.000Z',
        approved_at: '2026-08-05T18:00:00.000Z',
      },
    });
    expect(props.adjustmentNote).toBeNull();
  });

  // The pill's colour rides alongside the label rather than being parsed out
  // of it — `statusLabel` is already localized, so matching it would mean
  // matching English literals.
  it('carries a status tone the widget can colour a pill from', () => {
    const toneFor = (status: 'open' | 'submitted' | 'approved' | 'queried') =>
      buildNannyWeekPayload({
        ...base,
        timesheet: {
          status,
          total_minutes: 1035,
          updated_at: '2026-08-05T18:00:00.000Z',
          approved_at: null,
        },
      }).props.tone;

    expect(toneFor('open')).toBe('muted');
    expect(toneFor('submitted')).toBe('ochre');
    expect(toneFor('approved')).toBe('green');
    expect(toneFor('queried')).toBe('terracotta');
    expect(buildNannyWeekPayload({ ...base, timesheet: null }).props.tone).toBe(
      'muted'
    );
  });

  it('gives the parent hours and status but no nag and no money', () => {
    const { props } = buildParentWeekPayload({
      ...base,
      timesheet: {
        status: 'submitted',
        total_minutes: 1035,
        updated_at: '2026-08-02T18:00:00.000Z',
        approved_at: null,
      },
    });
    expect(props.hours).toBe('17h 15m');
    expect(props).not.toHaveProperty('adjustmentNote');
    expect(JSON.stringify(props)).not.toMatch(/£|\$|€|gross|pay/i);
  });

  describe('voided entries (069 soft delete)', () => {
    const voidedFirstDay = makeEntry({
      id: 'w1-voided',
      status: 'voided',
      clock_in_at: '2026-08-03T07:00:00.000Z',
      clock_out_at: '2026-08-03T16:00:00.000Z',
      scheduled_minutes: 480,
      local_date: '2026-08-03',
    });
    const activeSecondDay = makeEntry({
      id: 'w2',
      status: 'submitted',
      clock_in_at: '2026-08-04T07:00:00.000Z',
      clock_out_at: '2026-08-04T15:15:00.000Z',
      scheduled_minutes: 480,
      local_date: '2026-08-04',
    });
    const weekWithVoided = [voidedFirstDay, activeSecondDay];

    it('nanny week hours exclude voided worked minutes', () => {
      const { props } = buildNannyWeekPayload({
        ...base,
        entries: weekWithVoided,
        timesheet: null,
      });
      expect(props.hours).toBe('8h 15m');
    });

    it('parent week hours exclude voided worked minutes', () => {
      const { props } = buildParentWeekPayload({
        ...base,
        entries: weekWithVoided,
        timesheet: null,
      });
      expect(props.hours).toBe('8h 15m');
    });

    it('scheduledLine excludes voided scheduled_minutes', () => {
      const { props } = buildNannyWeekPayload({
        ...base,
        entries: weekWithVoided,
        timesheet: null,
      });
      expect(props.scheduledLine).toBe('of 8h scheduled');
    });

    it('does not show adjustmentNote when approved total_minutes already excludes voided entries', () => {
      const { props } = buildNannyWeekPayload({
        ...base,
        entries: weekWithVoided,
        timesheet: {
          status: 'approved',
          total_minutes: 495,
          updated_at: '2026-08-05T18:00:00.000Z',
          approved_at: '2026-08-05T18:00:00.000Z',
        },
      });
      expect(props.adjustmentNote).toBeNull();
    });
  });
});

describe('buildTodaysCoverPayload covering-shift selection', () => {
  const AUG10_NOW = new Date('2026-08-10T12:00:00.000Z').getTime();
  const base = {
    nowMs: AUG10_NOW,
    timeZone: ZONE,
    householdName: 'Household 1',
    namesByCarerId: { 'carer-nanny1': 'H1 Nanny1' },
    gaps: [],
    entries: [],
  };

  it('picks the confirmed shift when declined and cancelled shifts share the carer', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      shifts: [
        makeCoverShift({
          id: 'declined-0600',
          carerId: 'carer-nanny1',
          status: 'declined',
          localDate: '2026-08-10',
          startsAt: '2026-08-10T05:00:00.000Z',
          endsAt: '2026-08-10T19:00:00.000Z',
        }),
        makeCoverShift({
          id: 'cancelled-1',
          carerId: 'carer-nanny1',
          status: 'cancelled',
          localDate: '2026-08-10',
          startsAt: '2026-08-10T08:00:00.000Z',
          endsAt: '2026-08-10T12:00:00.000Z',
        }),
        makeCoverShift({
          id: 'cancelled-2',
          carerId: 'carer-nanny1',
          status: 'cancelled',
          localDate: '2026-08-10',
          startsAt: '2026-08-10T13:00:00.000Z',
          endsAt: '2026-08-10T17:00:00.000Z',
        }),
        makeCoverShift({
          id: 'confirmed-1122',
          carerId: 'carer-nanny1',
          status: 'confirmed',
          localDate: '2026-08-10',
          startsAt: '2026-08-10T10:22:00.000Z',
          endsAt: '2026-08-10T18:22:00.000Z',
        }),
      ],
    });
    expect(props.rows).toHaveLength(1);
    expect(props.rows[0]?.title).toMatch(/11:22/i);
    expect(props.rows[0]?.title).not.toMatch(/6:00|06:00/i);
  });

  it('never produces a row for a draft shift', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      shifts: [
        makeCoverShift({
          id: 'draft-only',
          carerId: null,
          status: 'draft',
          localDate: '2026-08-10',
          startsAt: '2026-08-10T09:00:00.000Z',
          endsAt: '2026-08-10T17:00:00.000Z',
        }),
      ],
    });
    expect(props.rows).toHaveLength(0);
  });

  it('labels parent_cover with the parent-covering copy, not carerFallback', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      shifts: [
        makeCoverShift({
          id: 'parent-cover-1',
          carerId: null,
          status: 'confirmed',
          kind: 'parent_cover',
          localDate: '2026-08-10',
          startsAt: '2026-08-10T09:00:00.000Z',
          endsAt: '2026-08-10T17:00:00.000Z',
        }),
      ],
    });
    expect(props.rows).toHaveLength(1);
    expect(props.rows[0]?.title).toMatch(/You're covering/i);
    expect(props.rows[0]?.title).not.toMatch(/Carer/i);
  });
});

describe('buildTodaysCoverPayload voided entries (069 soft delete)', () => {
  const base = {
    nowMs: NOW,
    timeZone: ZONE,
    householdName: 'Patel household',
    namesByCarerId: { 'carer-1': 'Sarah' },
    gaps: [],
  };

  it('does not surface a voided entry as a finished session', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [
        makeEntry({
          status: 'voided',
          clock_in_at: '2026-08-06T07:12:00.000Z',
          clock_out_at: '2026-08-06T16:04:00.000Z',
          break_minutes: 30,
        }),
      ],
      shifts: [],
    });
    expect(props.rows.some(row => row.kind === 'finished')).toBe(false);
  });

  it('finished-row detail excludes voided minutes when a carer also has a real session', () => {
    const { props } = buildTodaysCoverPayload({
      ...base,
      entries: [
        makeEntry({
          id: 'voided-morning',
          status: 'voided',
          clock_in_at: '2026-08-06T06:00:00.000Z',
          clock_out_at: '2026-08-06T10:00:00.000Z',
        }),
        makeEntry({
          id: 'real-afternoon',
          status: 'submitted',
          clock_in_at: '2026-08-06T12:00:00.000Z',
          clock_out_at: '2026-08-06T16:00:00.000Z',
        }),
      ],
      shifts: [],
    });
    const finished = props.rows.find(row => row.kind === 'finished');
    expect(finished?.detail).toBe('4h');
  });
});

describe('buildRedirectPayload (wrong persona)', () => {
  it('carries only the redirect copy, so every body takes its guard branch', () => {
    const { props, timeline } = buildRedirectPayload({
      nowMs: NOW,
      timeZone: ZONE,
      role: 'parent',
    });

    expect(props.fallbackTitle).toBe('For parents');
    expect(props.fallbackBody).toContain('Next Shift · Nanny');
    // No root prop of ANY widget: `!props.state` / `!props.rows` /
    // `!props.hours` all have to hold, or the body reads past the guard.
    expect(props).not.toHaveProperty('state');
    expect(props).not.toHaveProperty('rows');
    expect(props).not.toHaveProperty('hours');
    expect(props.deepLink).toBe('steadilynanny:///home');
    expect(timeline).toEqual([]);
  });

  it('names the parent widget when a nanny widget is on a parent phone', () => {
    const { props } = buildRedirectPayload({
      nowMs: NOW,
      timeZone: ZONE,
      role: 'nanny',
    });

    expect(props.fallbackTitle).toBe('For nannies');
    expect(props.fallbackBody).toContain("Today's Cover · Parent");
  });
});

describe('Spanish copy', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('es');
  });
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('localises the redirect copy but keeps the English gallery names', () => {
    const { props } = buildRedirectPayload({
      nowMs: NOW,
      timeZone: ZONE,
      role: 'nanny',
    });

    expect(props.fallbackTitle).toBe('Para niñeras');
    // The gallery strings come from app.config.js's Info.plist entries, which
    // the plugin cannot localize — so the Spanish body points at the English
    // name the user actually sees in the widget gallery.
    expect(props.fallbackBody).toContain("Today's Cover · Parent");
  });

  it('localises the cover rows, including the duration convention', () => {
    const { props } = buildTodaysCoverPayload({
      nowMs: NOW,
      timeZone: ZONE,
      householdName: 'Hogar Patel',
      namesByCarerId: { 'carer-1': 'Sara' },
      gaps: [],
      entries: [
        makeEntry({
          carer_display_name: 'Sara',
          status: 'submitted',
          clock_out_at: '2026-08-06T16:04:00.000Z',
          break_minutes: 30,
        }),
      ],
      shifts: [],
    });
    expect(props.title).toBe('Cobertura de hoy');
    expect(props.rows[0]?.title).toMatch(/^Sara terminó a las /);
    expect(props.rows[0]?.detail).toBe('8 h 22 min');
  });

  it('localises the nanny week widget', () => {
    const { props } = buildNannyWeekPayload({
      nowMs: NOW,
      timeZone: ZONE,
      householdName: 'Hogar Patel',
      entries: [
        makeEntry({
          status: 'submitted',
          clock_out_at: '2026-08-06T16:00:00.000Z',
          scheduled_minutes: 480,
        }),
      ],
      timesheet: null,
    });
    expect(props.title).toBe('Esta semana');
    expect(props.hours).toBe('8 h 48 min');
    expect(props.scheduledLine).toBe('de 8 h previstas');
  });
});

describe('applyWidgetSnapshots', () => {
  it('leaves a widget alone when the builder produced nothing for it', () => {
    const snapshots: object[] = [];
    const timelines: unknown[][] = [];
    registerWidgetTargets({
      nextShift: {
        updateSnapshot: props => snapshots.push(props),
        updateTimeline: entries => timelines.push(entries),
      },
    });

    applyWidgetSnapshots({});
    expect(snapshots).toHaveLength(0);

    const payload = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          startsAt: new Date(NOW + 3 * HOUR).toISOString(),
          endsAt: new Date(NOW + 11 * HOUR).toISOString(),
        }),
      ],
    });
    applyWidgetSnapshots({ nextShift: payload });

    // Platform is 'ios' under the test setup; on any other platform the whole
    // call is a no-op and neither array grows.
    const expected = 1;
    expect(snapshots).toHaveLength(expected);
    expect(timelines).toHaveLength(expected);
    expect((snapshots[0] as NextShiftWidgetProps).state.kind).toBe('nextShift');
    expect(timelines[0]).toHaveLength(3);
    resetWidgetTargets();
  });

  // `expo-widgets` stores the props verbatim with `UserDefaults.set`, and a JS
  // `null` arrives there as `NSNull` — not a property-list type, so the write
  // throws `Exception in HostFunction: <unknown>` and nothing is stored. Every
  // null must be gone by the time the native call sees the props.
  it('sends no null or undefined to the native side, at any depth', () => {
    const seen: unknown[] = [];
    registerWidgetTargets({
      nextShift: {
        updateSnapshot: props => seen.push(props),
        updateTimeline: entries => {
          for (const entry of entries) seen.push(entry.props);
        },
      },
    });

    // No children and nothing pending: `childrenLine` and `pending` are null.
    const payload = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [
        makeNannyShift({
          childNames: [],
          startsAt: new Date(NOW + 3 * HOUR).toISOString(),
          endsAt: new Date(NOW + 11 * HOUR).toISOString(),
        }),
      ],
    });
    expect(payload.props.pending).toBeNull();
    applyWidgetSnapshots({ nextShift: payload });

    expect(seen.length).toBeGreaterThan(1);
    for (const props of seen) {
      expect(JSON.stringify(props)).not.toContain('null');
    }
    resetWidgetTargets();
  });

  it('drops nulls out of arrays too, not just object keys', () => {
    const cleaned: unknown = widgetSafeProps({
      rows: [{ a: 1, b: null }, null],
    });
    expect(cleaned).toEqual({ rows: [{ a: 1 }] });
  });

  // The WidgetKit write goes over the App Group and the native side throws
  // when it can't happen. This runs in an `AppBootstrap` effect, so an
  // escaping throw takes every authenticated screen to the error boundary.
  it('swallows a target that throws, and still applies the others', () => {
    const applied: string[] = [];
    registerWidgetTargets({
      nextShift: {
        updateSnapshot: () => {
          throw new Error('Exception in HostFunction: <unknown>');
        },
        updateTimeline: () => {
          throw new Error('Exception in HostFunction: <unknown>');
        },
      },
      parentWeek: {
        updateSnapshot: () => applied.push('parentWeek'),
        updateTimeline: () => undefined,
      },
    });

    const nextShift = buildNextShiftPayload({
      nowMs: NOW,
      timeZone: ZONE,
      synced: true,
      running: null,
      shifts: [],
    });
    const parentWeek = buildParentWeekPayload({
      nowMs: NOW,
      timeZone: ZONE,
      householdName: 'Bramble House',
      entries: [],
      timesheet: null,
    });

    expect(() => applyWidgetSnapshots({ nextShift, parentWeek })).not.toThrow();
    expect(applied).toEqual(['parentWeek']);
    resetWidgetTargets();
  });
});
