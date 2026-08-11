/**
 * @module packages/shared-types — uncovered care computation
 */
import { describe, expect, it } from 'bun:test';
import {
  COVERING_SHIFT_STATUSES,
  type CoveredShiftInput,
  computeUncovered,
  type NeedWindowInput,
  SCHEDULED_SHIFT_STATUSES,
  type UncoveredWindow,
  uncoveredKey,
} from '../src/uncoveredCare';

// =============================================================================
// Test helpers — local wall-clock → UTC for shift/need fixture construction.
// Duplicates the module's Intl technique so tests stay independent of imports.
// =============================================================================

const TZ = 'Europe/London';
const MONDAY = '2026-03-23'; // Monday, GMT (before spring-forward)
const TUESDAY = '2026-03-24';
const CHILD_A = 'child-a';
const CHILD_B = 'child-b';
const WEEKDAY_RRULE = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';

function parseDateOnly(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
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
  return (localAsUtc - utcMillis) / 60_000;
}

function wallToUtcMillis(
  dateStr: string,
  timeStr: string,
  timeZone: string
): number {
  const { y, m, d } = parseDateOnly(dateStr);
  const [hh = 0, mi = 0, ss = 0] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mi, ss);
  const offset1 = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset1) {
    utc = guess - offset2 * 60_000;
  }
  return utc;
}

function wallIso(localDate: string, time: string, tz = TZ): string {
  return new Date(wallToUtcMillis(localDate, time, tz)).toISOString();
}

function makeNeed(overrides: Partial<NeedWindowInput> = {}): NeedWindowInput {
  return {
    id: overrides.id ?? 'need-1',
    childId: overrides.childId ?? CHILD_A,
    rrule: overrides.rrule ?? WEEKDAY_RRULE,
    startTime: overrides.startTime ?? '09:00',
    endTime: overrides.endTime ?? '17:00',
    startsOn: overrides.startsOn ?? null,
    endsOn: overrides.endsOn ?? null,
    exdates: overrides.exdates ?? [],
  };
}

function makeShift(
  overrides: Partial<CoveredShiftInput> & {
    startLocal?: string;
    endLocal?: string;
    localDate?: string;
  } = {}
): CoveredShiftInput {
  const localDate = overrides.localDate ?? MONDAY;
  const startsAt =
    overrides.startsAt ??
    (overrides.startLocal
      ? wallIso(localDate, overrides.startLocal)
      : wallIso(localDate, '09:00'));
  const endsAt =
    overrides.endsAt ??
    (overrides.endLocal
      ? wallIso(localDate, overrides.endLocal)
      : wallIso(localDate, '17:00'));
  return {
    id: overrides.id ?? 'shift-1',
    startsAt,
    endsAt,
    status: overrides.status ?? 'confirmed',
    children: overrides.children ?? [],
  };
}

function run(
  overrides: {
    localDate?: string;
    timezone?: string;
    needWindows?: readonly NeedWindowInput[];
    shifts?: readonly CoveredShiftInput[];
    closures?: readonly { startsAt: string; endsAt: string }[];
  } = {}
): UncoveredWindow[] {
  return computeUncovered({
    localDate: overrides.localDate ?? MONDAY,
    timezone: overrides.timezone ?? TZ,
    needWindows: overrides.needWindows ?? [makeNeed()],
    shifts: overrides.shifts ?? [],
    closures: overrides.closures ?? [],
  });
}

function expectOneWindow(
  windows: UncoveredWindow[],
  startLocal: string,
  endLocal: string,
  localDate = MONDAY
): void {
  expect(windows).toHaveLength(1);
  expect(Date.parse(windows[0].startsAt)).toBe(
    Date.parse(wallIso(localDate, startLocal))
  );
  expect(Date.parse(windows[0].endsAt)).toBe(
    Date.parse(wallIso(localDate, endLocal))
  );
}

// =============================================================================
// Cases
// =============================================================================

describe('computeUncovered', () => {
  it('1. need 09:00–17:00 with no shifts → one uncovered window spanning the whole need', () => {
    const windows = run();
    expectOneWindow(windows, '09:00', '17:00');
    expect(windows[0].childId).toBe(CHILD_A);
    expect(windows[0].commitmentId).toBe('need-1');
  });

  it('2. need 09:00–17:00, one covering shift 09:00–17:00 for that child → []', () => {
    const windows = run({
      shifts: [
        makeShift({
          startLocal: '09:00',
          endLocal: '17:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expect(windows).toEqual([]);
  });

  it('3. need 08:00–17:00, shift 10:00–15:00 → two uncovered windows 08:00–10:00 and 15:00–17:00', () => {
    const windows = run({
      needWindows: [makeNeed({ startTime: '08:00', endTime: '17:00' })],
      shifts: [
        makeShift({
          startLocal: '10:00',
          endLocal: '15:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expect(windows).toHaveLength(2);
    expect(Date.parse(windows[0].startsAt)).toBe(
      Date.parse(wallIso(MONDAY, '08:00'))
    );
    expect(Date.parse(windows[0].endsAt)).toBe(
      Date.parse(wallIso(MONDAY, '10:00'))
    );
    expect(Date.parse(windows[1].startsAt)).toBe(
      Date.parse(wallIso(MONDAY, '15:00'))
    );
    expect(Date.parse(windows[1].endsAt)).toBe(
      Date.parse(wallIso(MONDAY, '17:00'))
    );
  });

  it('4. need 09:00–12:00, shift 08:00–17:00 → [] (fully covered)', () => {
    const windows = run({
      needWindows: [makeNeed({ startTime: '09:00', endTime: '12:00' })],
      shifts: [
        makeShift({
          startLocal: '08:00',
          endLocal: '17:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expect(windows).toEqual([]);
  });

  it('5. shift exists but children lists a different child → need child fully uncovered', () => {
    const windows = run({
      shifts: [
        makeShift({
          startLocal: '09:00',
          endLocal: '17:00',
          children: [{ childId: CHILD_B, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expectOneWindow(windows, '09:00', '17:00');
  });

  it('6. shift with empty children array → covers all children → []', () => {
    const windows = run({
      shifts: [
        makeShift({
          startLocal: '09:00',
          endLocal: '17:00',
          children: [],
        }),
      ],
    });
    expect(windows).toEqual([]);
  });

  it('7. per-child window narrower than shift → uncovered 09:00–12:00', () => {
    const windows = run({
      needWindows: [makeNeed({ startTime: '09:00', endTime: '18:00' })],
      shifts: [
        makeShift({
          startLocal: '08:00',
          endLocal: '18:00',
          children: [
            {
              childId: CHILD_A,
              startsAt: wallIso(MONDAY, '12:00'),
              endsAt: wallIso(MONDAY, '18:00'),
            },
          ],
        }),
      ],
    });
    expectOneWindow(windows, '09:00', '12:00');
  });

  it('8. null startsAt/endsAt on shift_children entry → falls back to whole shift → covered', () => {
    const windows = run({
      shifts: [
        makeShift({
          startLocal: '09:00',
          endLocal: '17:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expect(windows).toEqual([]);
  });

  it('9. two adjoining shifts 09:00–12:00 and 12:00–15:00, need 09:00–17:00 → one uncovered 15:00–17:00', () => {
    const windows = run({
      shifts: [
        makeShift({
          id: 'shift-a',
          startLocal: '09:00',
          endLocal: '12:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
        makeShift({
          id: 'shift-b',
          startLocal: '12:00',
          endLocal: '15:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expectOneWindow(windows, '15:00', '17:00');
  });

  it('10. two shifts leaving a hole 09:00–11:00 and 13:00–17:00 → uncovered 11:00–13:00', () => {
    const windows = run({
      shifts: [
        makeShift({
          id: 'shift-a',
          startLocal: '09:00',
          endLocal: '11:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
        makeShift({
          id: 'shift-b',
          startLocal: '13:00',
          endLocal: '17:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expectOneWindow(windows, '11:00', '13:00');
  });

  it('11. two children each with need, one covered one not → one uncovered for uncovered child', () => {
    const windows = run({
      needWindows: [
        makeNeed({ id: 'need-a', childId: CHILD_A }),
        makeNeed({ id: 'need-b', childId: CHILD_B }),
      ],
      shifts: [
        makeShift({
          startLocal: '09:00',
          endLocal: '17:00',
          children: [{ childId: CHILD_A, startsAt: null, endsAt: null }],
        }),
      ],
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].childId).toBe(CHILD_B);
    expect(windows[0].commitmentId).toBe('need-b');
    expect(Date.parse(windows[0].startsAt)).toBe(
      Date.parse(wallIso(MONDAY, '09:00'))
    );
    expect(Date.parse(windows[0].endsAt)).toBe(
      Date.parse(wallIso(MONDAY, '17:00'))
    );
  });

  it('12. two different need windows for same child overlapping, no shifts → two windows not merged', () => {
    const windows = run({
      needWindows: [
        makeNeed({ id: 'need-a', startTime: '09:00', endTime: '14:00' }),
        makeNeed({ id: 'need-b', startTime: '12:00', endTime: '17:00' }),
      ],
    });
    expect(windows).toHaveLength(2);
    const byCommitment = new Map(windows.map(w => [w.commitmentId, w]));
    expect(byCommitment.has('need-a')).toBe(true);
    expect(byCommitment.has('need-b')).toBe(true);
    expect(byCommitment.get('need-a')?.childId).toBe(CHILD_A);
    expect(byCommitment.get('need-b')?.childId).toBe(CHILD_A);
  });

  it('13. closure spanning whole day → [] even with no shifts', () => {
    const windows = run({
      closures: [
        {
          startsAt: wallIso(MONDAY, '00:00'),
          endsAt: wallIso(MONDAY, '23:59'),
        },
      ],
    });
    expect(windows).toEqual([]);
  });

  it('14. closure covering only part of need → only non-closure part uncovered', () => {
    const windows = run({
      closures: [
        {
          startsAt: wallIso(MONDAY, '09:00'),
          endsAt: wallIso(MONDAY, '12:00'),
        },
      ],
    });
    expectOneWindow(windows, '12:00', '17:00');
  });

  it('15a. cancelled shift does not cover → need fully uncovered', () => {
    const windows = run({
      shifts: [
        makeShift({
          status: 'cancelled',
          startLocal: '09:00',
          endLocal: '17:00',
          children: [],
        }),
      ],
    });
    expectOneWindow(windows, '09:00', '17:00');
  });

  it('15b. declined shift does not cover → need fully uncovered', () => {
    const windows = run({
      shifts: [
        makeShift({
          status: 'declined',
          startLocal: '09:00',
          endLocal: '17:00',
          children: [],
        }),
      ],
    });
    expectOneWindow(windows, '09:00', '17:00');
  });

  it('15c. draft shift does not cover → need fully uncovered', () => {
    const windows = run({
      shifts: [
        makeShift({
          status: 'draft',
          startLocal: '09:00',
          endLocal: '17:00',
          children: [],
        }),
      ],
    });
    expectOneWindow(windows, '09:00', '17:00');
  });

  it('15d. pending shift does NOT cover → need fully uncovered (D-22)', () => {
    const windows = run({
      shifts: [
        makeShift({
          status: 'pending',
          startLocal: '09:00',
          endLocal: '17:00',
          children: [],
        }),
      ],
    });
    expectOneWindow(windows, '09:00', '17:00');
  });

  it('15e. completed shift does cover → []', () => {
    const windows = run({
      shifts: [
        makeShift({
          status: 'completed',
          startLocal: '09:00',
          endLocal: '17:00',
          children: [],
        }),
      ],
    });
    expect(windows).toEqual([]);
  });

  it('16. BYDAY=MO only, localDate is Tuesday → []', () => {
    const windows = run({
      localDate: TUESDAY,
      needWindows: [makeNeed({ rrule: 'FREQ=WEEKLY;BYDAY=MO' })],
    });
    expect(windows).toEqual([]);
  });

  it('17. exdates containing localDate → []', () => {
    const windows = run({
      needWindows: [makeNeed({ exdates: [MONDAY] })],
    });
    expect(windows).toEqual([]);
  });

  it('18a. startsOn in the future relative to localDate → []', () => {
    const windows = run({
      needWindows: [makeNeed({ startsOn: '2026-04-01' })],
    });
    expect(windows).toEqual([]);
  });

  it('18b. endsOn in the past → []', () => {
    const windows = run({
      needWindows: [makeNeed({ endsOn: '2026-03-01' })],
    });
    expect(windows).toEqual([]);
  });

  it('19. INTERVAL=2: on-week produces uncovered, off-week → []', () => {
    const need = makeNeed({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      startsOn: MONDAY,
    });
    const onWeek = run({ needWindows: [need], localDate: MONDAY });
    expectOneWindow(onWeek, '09:00', '17:00');

    const offWeek = run({
      needWindows: [need],
      localDate: '2026-03-30',
    });
    expect(offWeek).toEqual([]);
  });

  it('20. INTERVAL=2 with startsOn null → throws', () => {
    expect(() =>
      run({
        needWindows: [
          makeNeed({
            rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
            startsOn: null,
          }),
        ],
      })
    ).toThrow(/no starts_on/i);
  });

  it('21. unsupported FREQ=DAILY → throws', () => {
    expect(() =>
      run({
        needWindows: [makeNeed({ rrule: 'FREQ=DAILY' })],
      })
    ).toThrow(/only WEEKLY is supported/i);
  });

  it('22. DST spring-forward 2026-03-29: 09:00–17:00 local emits correct UTC instants', () => {
    const springSunday = '2026-03-29';
    const windows = run({
      localDate: springSunday,
      needWindows: [makeNeed({ rrule: 'FREQ=WEEKLY;BYDAY=SU' })],
      shifts: [],
    });
    expect(windows).toHaveLength(1);
    // BST (UTC+1) on 2026-03-29 after spring-forward — explicit ISO expectations.
    expect(Date.parse(windows[0].startsAt)).toBe(
      Date.parse('2026-03-29T08:00:00.000Z')
    );
    expect(Date.parse(windows[0].endsAt)).toBe(
      Date.parse('2026-03-29T16:00:00.000Z')
    );
  });

  it('23. +00:00 offset strings on covering shift still cover correctly', () => {
    const windows = run({
      shifts: [
        makeShift({
          startsAt: '2026-03-23T09:00:00.000+00:00',
          endsAt: '2026-03-23T17:00:00.000+00:00',
          children: [],
        }),
      ],
    });
    expect(windows).toEqual([]);
  });

  it('25a. empty needWindows → []', () => {
    expect(run({ needWindows: [] })).toEqual([]);
  });

  it('25b. need window with endTime not after startTime → []', () => {
    const windows = run({
      needWindows: [makeNeed({ startTime: '17:00', endTime: '09:00' })],
    });
    expect(windows).toEqual([]);
  });
});

describe('uncoveredKey', () => {
  it('24. returns childId|commitmentId|startsAt|endsAt and is stable', () => {
    const window: UncoveredWindow = {
      childId: CHILD_A,
      commitmentId: 'need-1',
      startsAt: '2026-03-23T09:00:00.000Z',
      endsAt: '2026-03-23T17:00:00.000Z',
    };
    const key = uncoveredKey(window);
    expect(key).toBe(
      `${CHILD_A}|need-1|2026-03-23T09:00:00.000Z|2026-03-23T17:00:00.000Z`
    );
    expect(uncoveredKey(window)).toBe(key);
  });
});

describe('COVERING_SHIFT_STATUSES (D-22)', () => {
  it('a pending ask is NOT cover — asking must never silence the alarm', () => {
    expect(COVERING_SHIFT_STATUSES).not.toContain('pending');
    expect([...COVERING_SHIFT_STATUSES].sort()).toEqual([
      'completed',
      'confirmed',
    ]);
  });

  it('SCHEDULED_SHIFT_STATUSES still carries pending — it is a different question', () => {
    expect([...SCHEDULED_SHIFT_STATUSES].sort()).toEqual([
      'completed',
      'confirmed',
      'pending',
    ]);
  });

  it('the two sets differ by exactly `pending`', () => {
    expect(
      SCHEDULED_SHIFT_STATUSES.filter(s => !COVERING_SHIFT_STATUSES.includes(s))
    ).toEqual(['pending']);
  });
});
