/**
 * Sick days (migration 068) — `kind` as a first-class property of a
 * carer_time_off row, driven through the command service.
 *
 * A sick day is NOT a new table and NOT a new status: it is the same row
 * with `kind = 'sick'`, moving through requested/confirmed/cancelled exactly
 * like a personal one. What these tests pin is (a) that the discriminator
 * survives the write path in both directions, (b) that the capability a sick
 * day actually needs — being created for TODAY, hours after it started —
 * exists and cannot be quietly removed, and (c) that the wire response is
 * still the shared contract.
 *
 * The conflict-push WORDING for a sick day lives in
 * `timeOffConflictNotify.test.ts`, next to the personal-kind wording it must
 * not disturb.
 */
import { describe, expect, it, mock } from 'bun:test';
import { CarerTimeOffMutationResponseSchema } from '../../../../../src/domains/availability/schemas';
import { TimeOffCommandService } from '../../../../../src/domains/availability/services/timeOffCommandService';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';

const CARER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fixed-shape row with wire-valid values, so the shared schema can parse it. */
const row: CarerTimeOff = {
  id: ROW_ID,
  user_id: CARER_ID,
  starts_at: new Date(Date.now() + 28 * DAY_MS).toISOString(),
  ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
  all_day: true,
  kind: 'personal',
  message: null,
  status: 'requested',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: '2026-08-01T09:00:00Z',
  updated_at: '2026-08-01T09:00:00Z',
};

function makeTimeOffRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...row,
      id,
      ...data,
    })),
    cancelById: mock(async (id: string) => ({
      ...row,
      id,
      status: 'cancelled',
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => row),
    assertActiveMember: mock(async () => undefined),
    ...overrides,
  };
}

function makeOverlapRepo(
  shifts: { id: string; household_id: string }[] = []
): any {
  return {
    listConfirmedForCarerInRange: mock(async () => shifts),
    // D77a: not under test here — no shift ever transitions.
    demoteConfirmedToPending: mock(async () => false),
  };
}

function makeMemberRepo(): any {
  return { listActiveByUser: mock(async () => []) };
}

function makeService(
  timeOffRepo: unknown,
  queries: unknown = makeQueries(),
  overlapRepo: unknown = makeOverlapRepo()
): TimeOffCommandService {
  return new TimeOffCommandService(
    timeOffRepo as never,
    queries as never,
    overlapRepo as never,
    mock(() => undefined),
    async () => undefined,
    makeMemberRepo(),
    // D-23: stubbed, or a sick day with an overlap reaches for a real
    // Supabase client and times the file out.
    mock(async () => undefined)
  );
}

describe('TimeOffCommandService.create — kind is persisted', () => {
  it('writes kind: sick when the carer calls in sick', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = makeService(timeOffRepo);

    const result = await svc.create(CARER_ID, {
      starts_at: new Date(Date.now() + 28 * DAY_MS).toISOString(),
      ends_at: new Date(Date.now() + 29 * DAY_MS).toISOString(),
      all_day: true,
      kind: 'sick',
    });

    expect(timeOffRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: CARER_ID, kind: 'sick' })
    );
    expect(result.carer_time_off.kind).toBe('sick');
  });

  // The SQL column default covers the database, but the service must not rely
  // on it: the insert payload is what a reader (and any future column-list
  // insert) sees, and "no kind at all" is not a state this domain has.
  it('writes kind: personal explicitly when the client omits it', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = makeService(timeOffRepo);

    const result = await svc.create(CARER_ID, {
      starts_at: new Date(Date.now() + 28 * DAY_MS).toISOString(),
      ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      all_day: true,
    });

    expect(timeOffRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: CARER_ID, kind: 'personal' })
    );
    expect(result.carer_time_off.kind).toBe('personal');
  });
});

// ---------------------------------------------------------------------------
// SAME-DAY CREATION. There is deliberately NO future-only guard on create —
// not on the shared Zod schema (which refines ends_at > starts_at and nothing
// else) and not in the service (whose only clock check is `update`'s "cannot
// edit PAST time off", keyed on ends_at, and unreachable for a day still in
// progress). A sick day is created at 06:30 for a day that started at 00:00,
// so "starts_at is already behind us" is the NORMAL case for this kind, not
// an error. These tests exist so that capability cannot be removed by someone
// adding a well-meaning "time off must be in the future" rule.
// ---------------------------------------------------------------------------
describe('TimeOffCommandService.create — same-day sick day', () => {
  it('accepts a sick day whose start is already in the past today', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = makeService(timeOffRepo);

    const now = Date.now();
    const startsAt = new Date(now - 6 * HOUR_MS).toISOString();
    const endsAt = new Date(now + 6 * HOUR_MS).toISOString();

    const result = await svc.create(CARER_ID, {
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: true,
      kind: 'sick',
    });

    expect(timeOffRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: CARER_ID,
        kind: 'sick',
        starts_at: startsAt,
        ends_at: endsAt,
      })
    );
    expect(result.carer_time_off.kind).toBe('sick');
  });

  it('accepts a sick day from start-of-today even when the whole range is behind us', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = makeService(timeOffRepo);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startsAt = startOfToday.toISOString();
    const endsAt = new Date(startOfToday.getTime() + HOUR_MS).toISOString();

    await svc.create(CARER_ID, {
      starts_at: startsAt,
      ends_at: endsAt,
      kind: 'sick',
    });

    expect(timeOffRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sick', starts_at: startsAt })
    );
  });
});

describe('TimeOffCommandService.update — kind', () => {
  // Not status-gated beyond what every other patchable field already is
  // (not cancelled, not past, status not patchable) — no new gating invented.
  it('promotes a still-requested personal request to sick', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const futureRow = {
      ...row,
      starts_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      ends_at: new Date(Date.now() + 48 * HOUR_MS).toISOString(),
    };
    const svc = makeService(
      timeOffRepo,
      makeQueries({ getOwned: mock(async () => futureRow) })
    );

    const result = await svc.update(CARER_ID, ROW_ID, { kind: 'sick' });

    expect(timeOffRepo.update).toHaveBeenCalledWith(ROW_ID, {
      kind: 'sick',
      sequence: 1,
    });
    expect(result.carer_time_off.kind).toBe('sick');
  });

  it('never writes kind when the patch does not mention it', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const futureRow = {
      ...row,
      kind: 'sick' as const,
      starts_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      ends_at: new Date(Date.now() + 48 * HOUR_MS).toISOString(),
    };
    const svc = makeService(
      timeOffRepo,
      makeQueries({ getOwned: mock(async () => futureRow) })
    );

    await svc.update(CARER_ID, ROW_ID, { message: 'back tomorrow' });

    expect(timeOffRepo.update).toHaveBeenCalledWith(ROW_ID, {
      message: 'back tomorrow',
      sequence: 1,
    });
  });
});

describe('sick time off on the wire', () => {
  it('the create response still parses as CarerTimeOffMutationResponseSchema, kind included', async () => {
    const svc = makeService(
      makeTimeOffRepo(),
      makeQueries(),
      makeOverlapRepo([{ id: 's1', household_id: 'hh-1' }])
    );

    const result = await svc.create(CARER_ID, {
      starts_at: new Date(Date.now() + 28 * DAY_MS).toISOString(),
      ends_at: new Date(Date.now() + 29 * DAY_MS).toISOString(),
      kind: 'sick',
    });

    const parsed = CarerTimeOffMutationResponseSchema.parse(result);
    expect(parsed.carer_time_off.kind).toBe('sick');
    expect(parsed.affected_shift_count).toBe(1);
    // Privacy: the wire carries a TOTAL, never a per-household breakdown.
    expect(Object.keys(parsed)).toEqual([
      'carer_time_off',
      'affected_shift_count',
    ]);
  });
});
