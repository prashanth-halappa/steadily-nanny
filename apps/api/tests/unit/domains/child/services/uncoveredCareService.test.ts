/**
 * Uncovered-care push + persist — mock.module BEFORE dynamic import so
 * notifyHouseholdParents can be asserted.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  CoveredShiftInput,
  NeedWindowInput,
} from '@steadily-nanny/shared-types/uncoveredCare';
import {
  computeUncovered,
  uncoveredKey,
} from '@steadily-nanny/shared-types/uncoveredCare';
import type { RaiseUncoveredArgs } from '../../../../../src/domains/child/services/uncoveredCareService';

const LONDON = 'Europe/London';
const MONDAY = '2026-08-03'; // Monday in Europe/London (BST)

function needWindow(overrides: Partial<NeedWindowInput> = {}): NeedWindowInput {
  return {
    id: 'cm1',
    childId: 'child1',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
    startTime: '09:00',
    endTime: '12:00',
    startsOn: null,
    endsOn: null,
    exdates: [],
    ...overrides,
  };
}

/** No shifts — the whole need window is uncovered. */
const baseArgs: RaiseUncoveredArgs = {
  householdId: 'h1',
  localDate: MONDAY,
  timezone: LONDON,
  shifts: [],
  needWindows: [needWindow()],
  closures: [],
  cause: 'nothingScheduled',
};

let UncoveredCareService: typeof import('../../../../../src/domains/child/services/uncoveredCareService').UncoveredCareService;
let UNCOVERED_PUSH_WITHIN_MS: number;
let notifyHouseholdParents: ReturnType<typeof mock>;

const FIXED_NOW = Date.parse('2026-08-01T12:00:00.000Z');
let realDateNow: typeof Date.now;

beforeAll(async () => {
  notifyHouseholdParents = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents,
    notifyUser: mock(() => undefined),
  }));

  ({ UncoveredCareService, UNCOVERED_PUSH_WITHIN_MS } = await import(
    '../../../../../src/domains/child/services/uncoveredCareService'
  ));
});

beforeEach(() => {
  notifyHouseholdParents.mockClear();
  realDateNow = Date.now;
  Date.now = () => FIXED_NOW;
});

afterEach(() => {
  Date.now = realDateNow;
});

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async (rows: unknown[]) => rows),
    ...overrides,
  };
}

describe('UncoveredCareService.raiseUncoveredOnce', () => {
  it('inserts one uncovered_care event per uncovered window with cause in payload', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    const result = await svc.raiseUncoveredOnce({
      ...baseArgs,
      cause: 'needsAdded',
      actorId: 'parent-1',
    });

    expect(result.inserted).toHaveLength(1);
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    const rows = eventRepo.insertMany.mock.calls[0]?.[0] as {
      event_type: string;
      shift_id: null;
      actor_id: string;
      payload: Record<string, unknown>;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('uncovered_care');
    expect(rows[0]?.shift_id).toBeNull();
    expect(rows[0]?.actor_id).toBe('parent-1');
    expect(rows[0]?.payload.cause).toBe('needsAdded');
    expect(rows[0]?.payload.child_id).toBe('child1');
    expect(rows[0]?.payload.commitment_id).toBe('cm1');
    expect(typeof rows[0]?.payload.starts_at).toBe('string');
    expect(typeof rows[0]?.payload.ends_at).toBe('string');
    expect(typeof rows[0]?.payload.key).toBe('string');
  });

  it('skips keys already present for that date (no insert, no push)', async () => {
    const [window] = computeUncovered({
      localDate: MONDAY,
      timezone: LONDON,
      needWindows: [needWindow()],
      shifts: [],
      closures: [],
    });
    if (!window) {
      throw new Error('expected uncovered window');
    }
    const existingKey = uncoveredKey(window);

    const eventRepo = makeEventRepo({
      listEventKeysForDate: mock(async () => new Set([existingKey])),
    });
    const svc = new UncoveredCareService(eventRepo);

    const result = await svc.raiseUncoveredOnce(baseArgs);

    expect(result.inserted).toHaveLength(0);
    expect(result.pushed).toHaveLength(0);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('does not push when insertMany creates nothing (F-B6-5 regression guard)', async () => {
    const eventRepo = makeEventRepo({
      insertMany: mock(async () => []),
    });
    const svc = new UncoveredCareService(eventRepo);

    const result = await svc.raiseUncoveredOnce(baseArgs);

    expect(result.inserted).toHaveLength(0);
    expect(result.pushed).toHaveLength(0);
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('returns and pushes only windows insertMany reports as created when a batch is partially suppressed', async () => {
    const eventRepo = makeEventRepo({
      insertMany: mock(async (rows: { payload: { commitment_id: string } }[]) =>
        rows.filter(row => row.payload.commitment_id === 'cm2')
      ),
    });
    const svc = new UncoveredCareService(eventRepo);

    const result = await svc.raiseUncoveredOnce({
      ...baseArgs,
      needWindows: [needWindow({ id: 'cm1' }), needWindow({ id: 'cm2' })],
    });

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0]?.commitmentId).toBe('cm2');
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
  });

  it('pushes immediately and marks push_gate "immediate" when the window starts within 72h', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    // baseArgs' window (Mon 3 Aug 09:00 Europe/London) sits ~44h after
    // FIXED_NOW (Sat 1 Aug 12:00 UTC) — inside the gate.
    const result = await svc.raiseUncoveredOnce(baseArgs);

    expect(result.inserted).toHaveLength(1);
    expect(result.pushed).toHaveLength(1);
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const rows = eventRepo.insertMany.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>;
    }[];
    expect(rows[0]?.payload.push_gate).toBe('immediate');
  });

  it('inserts silently and marks push_gate "digest" when every uncovered window starts more than 72h out', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    // 2026-08-06 09:00 Europe/London is ~117h after FIXED_NOW — outside the gate.
    const result = await svc.raiseUncoveredOnce({
      ...baseArgs,
      localDate: '2026-08-06',
    });

    expect(result.inserted).toHaveLength(1);
    expect(result.pushed).toHaveLength(0);
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
    const rows = eventRepo.insertMany.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>;
    }[];
    expect(rows[0]?.payload.push_gate).toBe('digest');
  });

  it('does not push a window that starts exactly 72h out — the gate is strictly-less-than', async () => {
    // Deterministic only because Date.now is stubbed to FIXED_NOW in
    // beforeEach: the boundary window's startsAt is pinned to exactly
    // FIXED_NOW + UNCOVERED_PUSH_WITHIN_MS, so `<` (not `<=`) is what's
    // under test, not real-clock timing.
    const boundaryInstant = new Date(FIXED_NOW + UNCOVERED_PUSH_WITHIN_MS);
    const boundaryDate = boundaryInstant.toISOString().slice(0, 10); // 2026-08-04, a Tuesday
    const boundaryTime = boundaryInstant.toISOString().slice(11, 16); // '12:00'

    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    const result = await svc.raiseUncoveredOnce({
      ...baseArgs,
      localDate: boundaryDate,
      timezone: 'UTC',
      needWindows: [
        needWindow({
          rrule: 'FREQ=WEEKLY;BYDAY=TU',
          startTime: boundaryTime,
          endTime: '23:00',
        }),
      ],
    });

    expect(result.inserted).toHaveLength(1);
    expect(result.pushed).toHaveLength(0);
    expect(notifyHouseholdParents).not.toHaveBeenCalled();
  });

  it('pushes with uncovered_care_detected type and localDate when windows are inserted', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    await svc.raiseUncoveredOnce(baseArgs);

    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        title: 'No one booked',
        body: 'A time you need your nanny is not on the schedule.',
        data: expect.objectContaining({
          type: PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED,
          householdId: 'h1',
          localDate: MONDAY,
        }),
      }),
      { excludeUserId: undefined }
    );
  });

  it('a mixed batch pushes only the imminent window, with a singular body and per-row push_gate', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    // Both commitments occur on the same Tuesday (2026-08-04, UTC), one
    // starting 66h after FIXED_NOW (imminent) and one 78h after (far out) —
    // a single call whose insert batch straddles the gate.
    const result = await svc.raiseUncoveredOnce({
      ...baseArgs,
      localDate: '2026-08-04',
      timezone: 'UTC',
      needWindows: [
        needWindow({
          id: 'cm-near',
          childId: 'child1',
          rrule: 'FREQ=WEEKLY;BYDAY=TU',
          startTime: '06:00',
          endTime: '07:00',
        }),
        needWindow({
          id: 'cm-far',
          childId: 'child2',
          rrule: 'FREQ=WEEKLY;BYDAY=TU',
          startTime: '18:00',
          endTime: '19:00',
        }),
      ],
    });

    expect(result.inserted).toHaveLength(2);
    expect(result.pushed).toHaveLength(1);
    expect(result.pushed[0]?.commitmentId).toBe('cm-near');
    expect(notifyHouseholdParents).toHaveBeenCalledTimes(1);
    expect(notifyHouseholdParents).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        body: 'A time you need your nanny is not on the schedule.',
      }),
      { excludeUserId: undefined }
    );

    const rows = eventRepo.insertMany.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>;
    }[];
    const gateByCommitment = new Map(
      rows.map(row => [row.payload.commitment_id, row.payload.push_gate])
    );
    expect(gateByCommitment.get('cm-near')).toBe('immediate');
    expect(gateByCommitment.get('cm-far')).toBe('digest');
  });

  it('push failure never fails persistence', async () => {
    notifyHouseholdParents.mockImplementation(() => {
      throw new Error('push boom');
    });
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);

    const result = await svc.raiseUncoveredOnce(baseArgs);

    expect(result.inserted).toHaveLength(1);
    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
  });

  it('returns [] when shifts fully cover the need window', async () => {
    const eventRepo = makeEventRepo();
    const svc = new UncoveredCareService(eventRepo);
    const coveringShift: CoveredShiftInput = {
      id: 'shift1',
      startsAt: '2026-08-03T07:00:00.000Z',
      endsAt: '2026-08-03T16:00:00.000Z',
      status: 'confirmed',
      children: [{ childId: 'child1', startsAt: null, endsAt: null }],
    };

    const result = await svc.raiseUncoveredOnce({
      ...baseArgs,
      shifts: [coveringShift],
    });

    expect(result.inserted).toHaveLength(0);
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });
});
