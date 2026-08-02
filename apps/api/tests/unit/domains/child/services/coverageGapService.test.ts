/**
 * Coverage-gap detector — case table. `computeGaps` is pure, so most cases
 * exercise it directly with no mocking; `raiseGapsOnce` cases mock only the
 * `ShiftEventRepository` dependency.
 *
 * @module tests/unit/domains/child/services/coverageGapService
 */
import { describe, expect, it, mock } from 'bun:test';
import {
  CoverageGapService,
  type GapCommitmentInput,
  type GapShiftInput,
} from '../../../../../src/domains/child/services/coverageGapService';

const LONDON = 'Europe/London';

function preschool(
  overrides: Partial<GapCommitmentInput> = {}
): GapCommitmentInput {
  return {
    id: 'cm1',
    childId: 'child1',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
    startTime: '09:00',
    endTime: '12:00',
    startsOn: null,
    endsOn: null,
    exdates: [],
    excludedFromCover: true,
    ...overrides,
  };
}

function shift(overrides: Partial<GapShiftInput> = {}): GapShiftInput {
  return {
    id: 'shift1',
    startsAt: '2026-08-03T08:00:00.000Z', // 08:00 London (BST, +1h off from
    endsAt: '2026-08-03T17:00:00.000Z', // wall clock — see per-test note)
    children: [{ childId: 'child1', startsAt: null, endsAt: null }],
    ...overrides,
  };
}

describe('CoverageGapService.computeGaps', () => {
  it('preschool 9-12 carves a gap from an 8-17 whole-shift window (Monday)', () => {
    const svc = new CoverageGapService();
    // 2026-08-03 is a Monday.
    const localDate = '2026-08-03';
    // 08:00-17:00 London wall-clock, in August (BST, UTC+1).
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
      }),
    ];
    const commitments = [preschool()];

    const gaps = svc.computeGaps(localDate, LONDON, shifts, commitments);

    expect(gaps).toEqual([
      {
        childId: 'child1',
        commitmentId: 'cm1',
        startsAt: '2026-08-03T08:00:00.000Z', // 09:00 London -> 08:00Z (BST)
        endsAt: '2026-08-03T11:00:00.000Z', // 12:00 London -> 11:00Z (BST)
      },
    ]);
  });

  it('no gap when the commitment is not excluded_from_cover', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
      }),
    ];
    const commitments = [preschool({ excludedFromCover: false })];

    expect(svc.computeGaps(localDate, LONDON, shifts, commitments)).toEqual([]);
  });

  it('no gap when the commitment does not occur on that weekday (BYDAY mismatch)', () => {
    const svc = new CoverageGapService();
    // 2026-08-08 is a Saturday — not in MO,TU,WE,TH.
    const localDate = '2026-08-08';
    const shifts = [
      shift({
        id: 'shift-sat',
        startsAt: '2026-08-08T07:00:00.000Z',
        endsAt: '2026-08-08T16:00:00.000Z',
      }),
    ];
    const commitments = [preschool()];

    expect(svc.computeGaps(localDate, LONDON, shifts, commitments)).toEqual([]);
  });

  it('no gap when the date is an exdate', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
      }),
    ];
    const commitments = [preschool({ exdates: [localDate] })];

    expect(svc.computeGaps(localDate, LONDON, shifts, commitments)).toEqual([]);
  });

  it('no gap before starts_on or after ends_on', () => {
    const svc = new CoverageGapService();
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
      }),
    ];

    const before = preschool({ startsOn: '2026-09-01' });
    expect(svc.computeGaps('2026-08-03', LONDON, shifts, [before])).toEqual([]);

    const after = preschool({ endsOn: '2026-08-01' });
    expect(svc.computeGaps('2026-08-03', LONDON, shifts, [after])).toEqual([]);
  });

  it('no gap for a different child than the commitment names', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
        children: [{ childId: 'other-child', startsAt: null, endsAt: null }],
      }),
    ];
    const commitments = [preschool()];

    expect(svc.computeGaps(localDate, LONDON, shifts, commitments)).toEqual([]);
  });

  it('no gap when the commitment window falls outside the shift entirely', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    // Shift only covers 13:00-16:00 local, well after preschool ends at 12:00.
    const shifts = [
      shift({
        startsAt: '2026-08-03T12:00:00.000Z', // 13:00 London
        endsAt: '2026-08-03T15:00:00.000Z', // 16:00 London
      }),
    ];
    const commitments = [preschool()];

    expect(svc.computeGaps(localDate, LONDON, shifts, commitments)).toEqual([]);
  });

  it('clips the gap to the shift boundary on partial overlap', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    // Shift ends at 10:30 London, mid-way through preschool (09:00-12:00).
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z', // 08:00 London
        endsAt: '2026-08-03T09:30:00.000Z', // 10:30 London
      }),
    ];
    const commitments = [preschool()];

    const gaps = svc.computeGaps(localDate, LONDON, shifts, commitments);
    expect(gaps).toEqual([
      {
        childId: 'child1',
        commitmentId: 'cm1',
        startsAt: '2026-08-03T08:00:00.000Z', // 09:00 London
        endsAt: '2026-08-03T09:30:00.000Z', // shift end, before preschool ends
      },
    ]);
  });

  it('honours a per-child shift_children window narrower than the whole shift', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z', // 08:00 London
        endsAt: '2026-08-03T16:00:00.000Z', // 17:00 London
        children: [
          {
            childId: 'child1',
            // This child is only covered 10:00-17:00 London — after preschool starts.
            startsAt: '2026-08-03T09:00:00.000Z',
            endsAt: '2026-08-03T16:00:00.000Z',
          },
        ],
      }),
    ];
    const commitments = [preschool()];

    const gaps = svc.computeGaps(localDate, LONDON, shifts, commitments);
    expect(gaps).toEqual([
      {
        childId: 'child1',
        commitmentId: 'cm1',
        startsAt: '2026-08-03T09:00:00.000Z', // covered-window start
        endsAt: '2026-08-03T11:00:00.000Z', // preschool end, 12:00 London
      },
    ]);
  });

  it('merges two touching partial gaps (adjoining shifts) into one interval', () => {
    const svc = new CoverageGapService();
    const localDate = '2026-08-03';
    const shifts = [
      shift({
        id: 'shift-a',
        startsAt: '2026-08-03T07:00:00.000Z', // 08:00 London
        endsAt: '2026-08-03T08:30:00.000Z', // 09:30 London
      }),
      shift({
        id: 'shift-b',
        startsAt: '2026-08-03T08:30:00.000Z', // 09:30 London
        endsAt: '2026-08-03T16:00:00.000Z', // 17:00 London
      }),
    ];
    const commitments = [preschool()];

    const gaps = svc.computeGaps(localDate, LONDON, shifts, commitments);
    expect(gaps).toEqual([
      {
        childId: 'child1',
        commitmentId: 'cm1',
        startsAt: '2026-08-03T08:00:00.000Z',
        endsAt: '2026-08-03T11:00:00.000Z',
      },
    ]);
  });

  it('respects RRULE INTERVAL=2 (fortnightly) anchored on starts_on', () => {
    const svc = new CoverageGapService();
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
      }),
    ];
    // starts_on is a Monday; INTERVAL=2 means every other Monday.
    const commitments = [
      preschool({
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
        startsOn: '2026-08-03',
      }),
    ];

    // Week 0 (the anchor week) — matches.
    expect(
      svc.computeGaps('2026-08-03', LONDON, shifts, commitments)
    ).toHaveLength(1);

    // Week 1 (the following Monday) — does not match.
    const shiftsWeek1 = [
      shift({
        startsAt: '2026-08-10T07:00:00.000Z',
        endsAt: '2026-08-10T16:00:00.000Z',
      }),
    ];
    expect(
      svc.computeGaps('2026-08-10', LONDON, shiftsWeek1, commitments)
    ).toEqual([]);

    // Week 2 — matches again.
    const shiftsWeek2 = [
      shift({
        startsAt: '2026-08-17T07:00:00.000Z',
        endsAt: '2026-08-17T16:00:00.000Z',
      }),
    ];
    expect(
      svc.computeGaps('2026-08-17', LONDON, shiftsWeek2, commitments)
    ).toHaveLength(1);
  });

  it('returns [] immediately when there are no excluded_from_cover commitments at all', () => {
    const svc = new CoverageGapService();
    const shifts = [
      shift({
        startsAt: '2026-08-03T07:00:00.000Z',
        endsAt: '2026-08-03T16:00:00.000Z',
      }),
    ];
    expect(svc.computeGaps('2026-08-03', LONDON, shifts, [])).toEqual([]);
  });

  it('throws for an unsupported RRULE FREQ', () => {
    const svc = new CoverageGapService();
    const shifts = [shift()];
    const commitments = [preschool({ rrule: 'FREQ=MONTHLY' })];
    expect(() =>
      svc.computeGaps('2026-08-03', LONDON, shifts, commitments)
    ).toThrow(/Unsupported RRULE FREQ/);
  });

  it('throws for RRULE INTERVAL > 1 with no starts_on anchor', () => {
    const svc = new CoverageGapService();
    const shifts = [shift()];
    const commitments = [
      preschool({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', startsOn: null }),
    ];
    expect(() =>
      svc.computeGaps('2026-08-03', LONDON, shifts, commitments)
    ).toThrow(/INTERVAL=2/);
  });
});

describe('CoverageGapService.raiseGapsOnce', () => {
  const localDate = '2026-08-03';
  const shifts = [
    shift({
      startsAt: '2026-08-03T07:00:00.000Z',
      endsAt: '2026-08-03T16:00:00.000Z',
    }),
  ];
  const commitments = [preschool()];

  function makeEventRepo(overrides: Record<string, unknown> = {}): any {
    return {
      listEventKeysForDate: mock(async () => new Set<string>()),
      insertMany: mock(async () => undefined),
      ...overrides,
    };
  }

  it('inserts one coverage_gap event when none exists yet', async () => {
    const eventRepo = makeEventRepo();
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce(
      'h1',
      localDate,
      LONDON,
      shifts,
      commitments
    );

    expect(inserted).toHaveLength(1);
    expect(eventRepo.listEventKeysForDate).toHaveBeenCalledWith(
      'h1',
      localDate,
      'coverage_gap'
    );
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    const [rows] = eventRepo.insertMany.mock.calls[0] as [any[]];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      household_id: 'h1',
      shift_id: null,
      local_date: localDate,
      event_type: 'coverage_gap',
    });
    expect(rows[0].payload.child_id).toBe('child1');
    expect(rows[0].payload.commitment_id).toBe('cm1');
    expect(typeof rows[0].payload.key).toBe('string');
  });

  it('is idempotent — skips a gap whose key was already raised', async () => {
    const gaps = new CoverageGapService().computeGaps(
      localDate,
      LONDON,
      shifts,
      commitments
    );
    const existingKey = `${gaps[0]?.childId}|${gaps[0]?.commitmentId}|${gaps[0]?.startsAt}|${gaps[0]?.endsAt}`;
    const eventRepo = makeEventRepo({
      listEventKeysForDate: mock(async () => new Set([existingKey])),
    });
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce(
      'h1',
      localDate,
      LONDON,
      shifts,
      commitments
    );

    expect(inserted).toEqual([]);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it('does not query or insert anything when there are no gaps', async () => {
    const eventRepo = makeEventRepo();
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, [
      preschool({ excludedFromCover: false }),
    ]);

    expect(inserted).toEqual([]);
    expect(eventRepo.listEventKeysForDate).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });

  it('keys on the commitment too — two different commitments producing an IDENTICAL interval stay two events', async () => {
    // Two excluded-from-cover commitments for the same child, same window,
    // e.g. a preschool block and an activity booked inside it. Keying on
    // (child, interval) alone collapsed these into one raised gap.
    const eventRepo = makeEventRepo();
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, [
      preschool({ id: 'cm1' }),
      preschool({ id: 'cm2' }),
    ]);

    expect(inserted).toHaveLength(2);
    const [rows] = eventRepo.insertMany.mock.calls[0] as [any[]];
    const keys = rows.map(row => row.payload.key as string);
    expect(new Set(keys).size).toBe(2);
    expect(keys.some(key => key.includes('cm1'))).toBe(true);
    expect(keys.some(key => key.includes('cm2'))).toBe(true);
  });

  it('skips only the already-raised commitment when a sibling commitment shares the interval', async () => {
    const gaps = new CoverageGapService().computeGaps(
      localDate,
      LONDON,
      shifts,
      [preschool({ id: 'cm1' }), preschool({ id: 'cm2' })]
    );
    const raised = gaps.find(gap => gap.commitmentId === 'cm1');
    const eventRepo = makeEventRepo({
      listEventKeysForDate: mock(
        async () =>
          new Set([
            `${raised?.childId}|${raised?.commitmentId}|${raised?.startsAt}|${raised?.endsAt}`,
          ])
      ),
    });
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, [
      preschool({ id: 'cm1' }),
      preschool({ id: 'cm2' }),
    ]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.commitmentId).toBe('cm2');
  });
});
