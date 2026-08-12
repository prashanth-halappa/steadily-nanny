/**
 * Gap push copy when cause is a known decline/cancellation — must carry the
 * cause, not a generic "someone is uncovered" line.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { RaiseUncoveredArgs } from '../../../../../src/domains/child/services/uncoveredCareService';
import {
  formatPushShortDate,
  formatPushTime12h,
} from '../../../../../src/domains/child/services/uncoveredCareService';
import { localDateOf } from '../../../../../src/domains/timesheet/utils/weekStart';

const DAY_MS = 24 * 60 * 60 * 1000;
const LONDON = 'Europe/London';
const PUSH_WITHIN_MS = 72 * 60 * 60 * 1000;

function localWeekdayCode(localDate: string, timeZone: string): string {
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(`${localDate}T12:00:00`));
  const map: Record<string, string> = {
    Sun: 'SU',
    Mon: 'MO',
    Tue: 'TU',
    Wed: 'WE',
    Thu: 'TH',
    Fri: 'FR',
    Sat: 'SA',
  };
  return map[short] ?? 'MO';
}

function wallIso(localDate: string, time: string, timeZone: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh = 0, mi = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh, mi, 0);
  const offsetMinutes = (utcMillis: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utcMillis));
    const get = (type: string): number =>
      Number(parts.find(part => part.type === type)?.value ?? '0');
    const localAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second')
    );
    return (localAsUtc - utcMillis) / 60_000;
  };
  const offset1 = offsetMinutes(guess);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutes(utc);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return new Date(utc).toISOString();
}

function shiftWithinPushWindow(timeZone: string): {
  localDate: string;
  startsAt: string;
  endsAt: string;
  weekdayCode: string;
} {
  let instant = Date.now() + 60 * 60 * 1000;
  while (instant - Date.now() < PUSH_WITHIN_MS) {
    const localDate = localDateOf(new Date(instant), timeZone);
    const startsAt = wallIso(localDate, '06:00', timeZone);
    if (Date.parse(startsAt) - Date.now() < PUSH_WITHIN_MS) {
      return {
        localDate,
        startsAt,
        endsAt: wallIso(localDate, '20:00', timeZone),
        weekdayCode: localWeekdayCode(localDate, timeZone),
      };
    }
    instant += DAY_MS;
  }
  throw new Error('no shift start within uncovered push window');
}

const {
  localDate: FUTURE_LOCAL_DATE,
  startsAt: FUTURE_START,
  endsAt: FUTURE_END,
  weekdayCode: FUTURE_WEEKDAY,
} = shiftWithinPushWindow(LONDON);

const baseArgs: RaiseUncoveredArgs = {
  householdId: 'h1',
  localDate: FUTURE_LOCAL_DATE,
  timezone: LONDON,
  shifts: [
    {
      id: 'declined-shift',
      startsAt: FUTURE_START,
      endsAt: FUTURE_END,
      status: 'declined',
      children: [{ childId: 'child1', startsAt: null, endsAt: null }],
    },
  ],
  needWindows: [
    {
      id: 'cm1',
      childId: 'child1',
      rrule: `FREQ=WEEKLY;BYDAY=${FUTURE_WEEKDAY}`,
      startTime: '06:00',
      endTime: '20:00',
      startsOn: null,
      endsOn: null,
      exdates: [],
    },
  ],
  closures: [],
  cause: 'declined',
  actorId: 'carer-1',
};

let UncoveredCareService: typeof import('../../../../../src/domains/child/services/uncoveredCareService').UncoveredCareService;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser: mock(() => undefined),
  }));

  ({ UncoveredCareService } = await import(
    '../../../../../src/domains/child/services/uncoveredCareService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
});

function makeEventRepo(): any {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async (rows: unknown[]) => rows),
  };
}

function makeService(eventRepo = makeEventRepo()) {
  return new UncoveredCareService(
    eventRepo,
    {
      findByHouseholdAndLocalDate: mock(async () => [
        {
          id: 'declined-shift',
          household_id: 'h1',
          carer_id: 'carer-1',
          starts_at: FUTURE_START,
          ends_at: FUTURE_END,
          timezone: LONDON,
          local_date: FUTURE_LOCAL_DATE,
          status: 'declined',
          shift_children: [{ child_id: 'child1' }],
        },
      ]),
    } as never,
    {
      listActiveByHousehold: mock(async () => [
        {
          user_id: 'carer-1',
          role: 'nanny',
          display_name_override: 'H1 Nanny1',
          profile_name: null,
        },
      ]),
    } as never,
    {
      findActiveByHousehold: mock(async () => [
        { id: 'child1', household_id: 'h1', name: 'H1 Child1' },
      ]),
    } as never
  );
}

describe('UncoveredCareService.raiseUncoveredOnce — cause-aware gap push', () => {
  it('carries the decline cause in the push body instead of a generic uncovered line', async () => {
    await makeService().raiseUncoveredOnce(baseArgs);

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const payload = notifyHouseholdParents.mock.calls[0]?.[1] as {
      body: string;
    };
    expect(payload.body).toContain('H1 Nanny1 turned down');
    expect(payload.body).toContain(
      formatPushShortDate(FUTURE_LOCAL_DATE, LONDON)
    );
    expect(payload.body).toContain(formatPushTime12h(FUTURE_START, LONDON));
    expect(payload.body).toContain(formatPushTime12h(FUTURE_END, LONDON));
    expect(payload.body).toContain('H1 Child1');
    expect(payload.body).not.toContain('not on the schedule');
  });
});
