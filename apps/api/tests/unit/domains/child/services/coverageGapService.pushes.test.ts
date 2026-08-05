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
    insertMany: mock(async () => undefined),
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
