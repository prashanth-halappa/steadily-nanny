import { describe, expect, it, mock } from 'bun:test';
import { TimeOffNotFoundError } from '../../../../../src/domains/availability/errors/availabilityErrors';
import { TimeOffCommandService } from '../../../../../src/domains/availability/services/timeOffCommandService';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';

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
