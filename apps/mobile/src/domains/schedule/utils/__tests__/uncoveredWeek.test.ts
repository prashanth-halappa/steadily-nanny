/**
 * @module domains/schedule/utils/__tests__/uncoveredWeek.test
 *
 * Pure week adapter over `computeUncovered` — mirrors API mapping helpers.
 */
import { describe, expect, it } from 'bun:test';
import type { HouseholdClosure } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import {
  closuresForLocalDate,
  computeUncoveredWeek,
  toCoveredShift,
  toNeedWindow,
} from '../uncoveredWeek';

const TZ = 'Europe/London';
const MONDAY = '2026-03-23';
const TUESDAY = '2026-03-24';
const CHILD_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function wallIso(localDate: string, time: string, tz = TZ): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh = 0, mi = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh, mi, 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(guess));
  const get = (type: string): number =>
    Number(parts.find(p => p.type === type)?.value ?? '0');
  const localAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  const offset1 = (localAsUtc - guess) / 60_000;
  let utc = guess - offset1 * 60_000;
  const offset2 =
    (Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second')
    ) -
      utc) /
    60_000;
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return new Date(utc).toISOString();
}

function makeCommitment(
  overrides: Partial<ChildCommitment> = {}
): ChildCommitment {
  return {
    id: COMMITMENT_ID,
    child_id: CHILD_A,
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    kind: 'school',
    label: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    start_time: '09:00:00',
    end_time: '17:00:00',
    starts_on: null,
    ends_on: null,
    exdates: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeShift(
  overrides: Partial<Shift> & { localDate?: string } = {}
): Shift {
  const localDate = overrides.local_date ?? overrides.localDate ?? MONDAY;
  return {
    id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    carer_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    created_by: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
    kind: 'recurring',
    status: 'confirmed',
    origin: 'system_generated',
    starts_at: wallIso(localDate, '09:00'),
    ends_at: wallIso(localDate, '17:00'),
    timezone: TZ,
    local_date: localDate,
    is_short_notice: false,
    source_pattern_id: null,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift@test',
    sequence: 0,
    shift_children: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

describe('toCoveredShift', () => {
  it('maps shift_children the same way as the API', () => {
    const mapped = toCoveredShift(
      makeShift({
        shift_children: [
          {
            id: 'sc-1',
            shift_id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
            child_id: CHILD_A,
            starts_at: wallIso(MONDAY, '10:00'),
            ends_at: wallIso(MONDAY, '12:00'),
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    );
    expect(mapped.children).toEqual([
      {
        childId: CHILD_A,
        startsAt: wallIso(MONDAY, '10:00'),
        endsAt: wallIso(MONDAY, '12:00'),
      },
    ]);
  });
});

describe('toNeedWindow', () => {
  it('maps commitment fields to NeedWindowInput', () => {
    const commitment = makeCommitment();
    expect(toNeedWindow(commitment)).toEqual({
      id: COMMITMENT_ID,
      childId: CHILD_A,
      rrule: commitment.rrule,
      startTime: '09:00:00',
      endTime: '17:00:00',
      startsOn: null,
      endsOn: null,
      exdates: [],
    });
  });
});

describe('closuresForLocalDate', () => {
  it('returns closures overlapping the local calendar day', () => {
    const closures: HouseholdClosure[] = [
      {
        id: 'cl-1',
        household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
        starts_at: wallIso(MONDAY, '00:00'),
        ends_at: wallIso(MONDAY, '23:59'),
        message: null,
        created_by: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    const mapped = closuresForLocalDate(closures, MONDAY, TZ);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.startsAt).toBe(closures[0]?.starts_at);
  });
});

describe('computeUncoveredWeek', () => {
  it('returns per-day windows and a total count across the week', () => {
    const commitments = [makeCommitment()];
    const shifts = [
      makeShift({ local_date: MONDAY }),
      makeShift({
        id: 'shift-tue-gap',
        local_date: TUESDAY,
        status: 'cancelled',
      }),
    ];
    const result = computeUncoveredWeek({
      weekDates: [MONDAY, TUESDAY],
      timezone: TZ,
      commitments,
      shifts,
      closures: [],
    });

    expect(result.byDay[MONDAY]).toEqual([]);
    expect(result.byDay[TUESDAY]?.length).toBeGreaterThan(0);
    expect(result.totalCount).toBe(result.byDay[TUESDAY]?.length ?? 0);
  });

  it('treats a closure day as fully covered', () => {
    const commitments = [makeCommitment()];
    const closures: HouseholdClosure[] = [
      {
        id: 'cl-1',
        household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
        starts_at: wallIso(MONDAY, '00:00'),
        ends_at: wallIso(TUESDAY, '00:00'),
        message: null,
        created_by: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    const result = computeUncoveredWeek({
      weekDates: [MONDAY],
      timezone: TZ,
      commitments,
      shifts: [],
      closures,
    });
    expect(result.totalCount).toBe(0);
  });
});
