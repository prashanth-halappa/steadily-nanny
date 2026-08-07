/**
 * Coverage-gap push — mock.module BEFORE dynamic import so
 * notifyHouseholdParents can be asserted.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  GapCommitmentInput,
  GapShiftInput,
} from '../../../../../src/domains/child/services/coverageGapService';

const LONDON = 'Europe/London';
const localDate = '2026-08-03';

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
    startsAt: '2026-08-03T07:00:00.000Z',
    endsAt: '2026-08-03T16:00:00.000Z',
    children: [{ childId: 'child1', startsAt: null, endsAt: null }],
    ...overrides,
  };
}

const shifts = [shift()];
const commitments = [preschool()];

let CoverageGapService: typeof import('../../../../../src/domains/child/services/coverageGapService').CoverageGapService;
let notifyHouseholdParents: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser: mock(() => undefined),
  }));

  ({ CoverageGapService } = await import(
    '../../../../../src/domains/child/services/coverageGapService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
});

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    // Default: everything submitted was genuinely created (no concurrent
    // race) — mirrors `ShiftEventRepository.insertMany`'s
    // `ON CONFLICT DO NOTHING RETURNING` contract (F-B6-5).
    insertMany: mock(async (rows: unknown[]) => rows),
    ...overrides,
  };
}

describe('CoverageGapService.raiseGapsOnce — pushes', () => {
  it('notifies household parents once with coverage_gap_detected for newly inserted gaps', async () => {
    const eventRepo = makeEventRepo();
    const svc = new CoverageGapService(eventRepo);

    await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, commitments);

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: 'Coverage gap',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.COVERAGE_GAP_DETECTED,
          householdId: 'h1',
        }),
      })
    );
  });

  it('does not push when every gap was already raised', async () => {
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

    await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, commitments);

    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('does not push when there are no gaps to raise', async () => {
    const eventRepo = makeEventRepo();
    const svc = new CoverageGapService(eventRepo);

    await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, [
      preschool({ excludedFromCover: false }),
    ]);

    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('sends one summary push even when multiple new gaps are inserted', async () => {
    const eventRepo = makeEventRepo();
    const svc = new CoverageGapService(eventRepo);

    await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, [
      preschool({ id: 'cm1' }),
      preschool({ id: 'cm2' }),
    ]);

    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  // F-B6-5 (reopened): migration 025's dedupe index is a partial EXPRESSION
  // index, which PostgREST's `ignoreDuplicates` cannot target (it only
  // accepts a column-name `onConflict`) — a concurrent duplicate-keyed insert
  // 23505s the WHOLE batch instead of being silently skipped.
  // `ShiftEventRepository.insertMany` catches that and retries row by row,
  // returning only the rows THIS call genuinely created; a loser's per-row
  // 23505 is swallowed there, never reaching this service. From here, that's
  // observable only as "insertMany resolved with fewer rows than we asked
  // for" — this test pins that `raiseGapsOnce` must not push (or report as
  // inserted) a gap that lost that race.
  it('does not push when insertMany creates nothing (a concurrent run already inserted the same key)', async () => {
    const eventRepo = makeEventRepo({
      // The filter saw the key as free, but by the time our row-by-row
      // fallback ran, a concurrent writer already had it.
      insertMany: mock(async () => []),
    });
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce(
      'h1',
      localDate,
      LONDON,
      shifts,
      commitments
    );

    expect(inserted).toHaveLength(0);
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('pushes once when insertMany reports the gap was actually created', async () => {
    const eventRepo = makeEventRepo({
      insertMany: mock(async (rows: unknown[]) => rows),
    });
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce(
      'h1',
      localDate,
      LONDON,
      shifts,
      commitments
    );

    expect(inserted).toHaveLength(1);
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  // Pins the PARTIAL-subset shape a real race actually produces: two gaps
  // submitted, only one wins the row-by-row fallback. Every other test here
  // has insertMany return everything or nothing — this is the one that
  // exercises the key-matching (not just a length check) between what was
  // submitted and what insertMany actually reports as created.
  it('returns and pushes only the gap insertMany reports as created, when a batch is partially suppressed', async () => {
    const eventRepo = makeEventRepo({
      insertMany: mock(async (rows: { payload: { commitment_id: string } }[]) =>
        rows.filter(row => row.payload.commitment_id === 'cm2')
      ),
    });
    const svc = new CoverageGapService(eventRepo);

    const inserted = await svc.raiseGapsOnce('h1', localDate, LONDON, shifts, [
      preschool({ id: 'cm1' }),
      preschool({ id: 'cm2' }),
    ]);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.commitmentId).toBe('cm2');
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('push failure never fails gap persistence', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });
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
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
  });
});
