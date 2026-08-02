import { describe, expect, it, mock } from 'bun:test';
import { TimeOffNotFoundError } from '../../../../../src/domains/availability/errors/availabilityErrors';
import { TimeOffCommandService } from '../../../../../src/domains/availability/services/timeOffCommandService';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';
import { ValidationError } from '../../../../../src/errors';

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'u1',
  starts_at: '2026-08-10T00:00:00Z',
  ends_at: '2026-08-12T00:00:00Z',
  all_day: true,
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: 't',
  updated_at: 't',
};

function makeTimeOffRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
      id: 't-new',
    })),
    cancelById: mock(async (id: string) => ({
      ...row,
      id,
      status: 'cancelled',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...row,
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => row),
    ...overrides,
  };
}

describe('TimeOffCommandService.create', () => {
  it('creates a time-off row for the caller', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(timeOffRepo, makeQueries());

    const result = await svc.create('u1', {
      starts_at: '2026-08-10T00:00:00Z',
      ends_at: '2026-08-12T00:00:00Z',
      all_day: true,
    });

    expect(timeOffRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        starts_at: '2026-08-10T00:00:00Z',
        ends_at: '2026-08-12T00:00:00Z',
        all_day: true,
      })
    );
    expect(result.id).toBe('t-new');
  });
});

describe('TimeOffCommandService.cancel', () => {
  it("soft-cancels the caller's own row — the repository is called with status: 'cancelled', never a hard delete", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries();
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    const result = await svc.cancel('u1', 't1');

    expect(queries.getOwned).toHaveBeenCalledWith('u1', 't1');
    expect(timeOffRepo.cancelById).toHaveBeenCalledWith('t1');
    expect(result.status).toBe('cancelled');
  });

  it("throws TimeOffNotFoundError and never calls cancelById when the row isn't the caller's own", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => {
        throw new TimeOffNotFoundError('t1');
      }),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    await expect(svc.cancel('someone-else', 't1')).rejects.toBeInstanceOf(
      TimeOffNotFoundError
    );
    expect(timeOffRepo.cancelById).not.toHaveBeenCalled();
  });
});

describe('TimeOffCommandService.update', () => {
  it('updates dates and message on an active row owned by the caller', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries();
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    const result = await svc.update('u1', 't1', {
      starts_at: '2026-08-11T00:00:00Z',
      ends_at: '2026-08-13T00:00:00Z',
      message: 'Extended by a day',
    });

    expect(queries.getOwned).toHaveBeenCalledWith('u1', 't1');
    expect(timeOffRepo.update).toHaveBeenCalledWith('t1', {
      starts_at: '2026-08-11T00:00:00Z',
      ends_at: '2026-08-13T00:00:00Z',
      message: 'Extended by a day',
      sequence: 1,
    });
    expect(result.message).toBe('Extended by a day');
  });

  it("throws TimeOffNotFoundError and never calls update when the row isn't the caller's own", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => {
        throw new TimeOffNotFoundError('t1');
      }),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    await expect(
      svc.update('someone-else', 't1', { message: 'nope' })
    ).rejects.toBeInstanceOf(TimeOffNotFoundError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('validates the resulting range when only starts_at is patched', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(timeOffRepo, makeQueries());

    await expect(
      svc.update('u1', 't1', { starts_at: '2026-08-13T00:00:00Z' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('rejects edits to a cancelled row', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => ({ ...row, status: 'cancelled' })),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    await expect(
      svc.update('u1', 't1', { message: 'too late' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('rejects status changes via PATCH — cancel stays on DELETE', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(timeOffRepo, makeQueries());

    await expect(
      svc.update('u1', 't1', { status: 'cancelled' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  // The next two cases are constructed so lexicographic string comparison
  // and Date-instant comparison DISAGREE — that's what makes them
  // discriminating against a revert of timeOffCommandService.ts:87 from
  // `Date.parse(effectiveEnds) <= Date.parse(effectiveStarts)` back to a
  // bare `effectiveEnds <= effectiveStarts` string compare. Payloads that
  // merely differ in offset without flipping the ordering (e.g. an ends_at
  // whose calendar day already sorts correctly as a string) pass under
  // EITHER implementation and prove nothing.

  it('rejects a range that is invalid by Date-instant but "valid" by lexicographic string order', async () => {
    // ends_at (stored, no offset): 2026-08-12T02:00:00Z
    // starts_at (patched, -08:00): 2026-08-11T20:00:00-08:00 = 2026-08-12T04:00:00Z
    // True instants: ends (02:00) is BEFORE starts (04:00) — genuinely invalid.
    // String order: '2026-08-12T02...' > '2026-08-11T20...' — lexicographic
    // compare says ends > starts, i.e. wrongly "valid". Reverting line 87 to
    // a string compare makes this test's `rejects` assertion fail.
    const storedRow = {
      ...row,
      ends_at: '2026-08-12T02:00:00Z',
    };
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => storedRow),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    await expect(
      svc.update('u1', 't1', { starts_at: '2026-08-11T20:00:00-08:00' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('accepts a range that is valid by Date-instant but "invalid" by lexicographic string order — the mirror case', async () => {
    // starts_at (stored, no offset): 2026-08-12T04:00:00Z
    // ends_at (patched, -08:00): 2026-08-11T20:30:00-08:00 = 2026-08-12T04:30:00Z
    // True instants: ends (04:30) is AFTER starts (04:00) — genuinely valid,
    // a 30-minute span. String order: '2026-08-11T20...' < '2026-08-12T04...'
    // — lexicographic compare says ends <= starts, i.e. wrongly "invalid".
    // Reverting line 87 to a string compare makes this throw instead of
    // reaching the repository.
    const storedRow = {
      ...row,
      starts_at: '2026-08-12T04:00:00Z',
    };
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => storedRow),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    const result = await svc.update('u1', 't1', {
      ends_at: '2026-08-11T20:30:00-08:00',
    });

    expect(timeOffRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        ends_at: '2026-08-11T20:30:00-08:00',
        sequence: 1,
      })
    );
    expect(result.ends_at).toBe('2026-08-11T20:30:00-08:00');
  });

  it('rejects edits to past time off (ends_at already before now)', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => ({
        ...row,
        starts_at: '2020-01-01T00:00:00Z',
        ends_at: '2020-01-05T00:00:00Z',
      })),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    await expect(
      svc.update('u1', 't1', { message: 'too late' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('bumps sequence on every successful PATCH for calendar sync', async () => {
    const storedRow = { ...row, sequence: 3 };
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => storedRow),
    });
    const svc = new TimeOffCommandService(timeOffRepo, queries);

    await svc.update('u1', 't1', { message: 'note' });

    expect(timeOffRepo.update).toHaveBeenCalledWith('t1', {
      message: 'note',
      sequence: 4,
    });
  });
});
