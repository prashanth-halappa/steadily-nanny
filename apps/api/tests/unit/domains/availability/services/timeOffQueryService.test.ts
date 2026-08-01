import { describe, expect, it, mock } from 'bun:test';
import { TimeOffNotFoundError } from '../../../../../src/domains/availability/errors/availabilityErrors';
import { TimeOffQueryService } from '../../../../../src/domains/availability/services/timeOffQueryService';
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
    listByUserId: mock(async () => [row]),
    findById: mock(async () => row),
    ...overrides,
  };
}

describe('TimeOffQueryService.listOwn', () => {
  it("returns the caller's own time-off rows", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffQueryService(timeOffRepo);
    expect(await svc.listOwn('u1')).toEqual([row]);
    expect(timeOffRepo.listByUserId).toHaveBeenCalledWith('u1');
  });
});

describe('TimeOffQueryService.getOwned', () => {
  it('returns the row when it belongs to the caller', async () => {
    const svc = new TimeOffQueryService(makeTimeOffRepo());
    expect(await svc.getOwned('u1', 't1')).toEqual(row);
  });

  it('throws TimeOffNotFoundError when the row belongs to someone else', async () => {
    const svc = new TimeOffQueryService(makeTimeOffRepo());
    await expect(svc.getOwned('someone-else', 't1')).rejects.toBeInstanceOf(
      TimeOffNotFoundError
    );
  });

  it('throws the SAME TimeOffNotFoundError when the row does not exist at all', async () => {
    const svc = new TimeOffQueryService(
      makeTimeOffRepo({ findById: mock(async () => null) })
    );
    await expect(svc.getOwned('u1', 'missing')).rejects.toBeInstanceOf(
      TimeOffNotFoundError
    );
  });
});
