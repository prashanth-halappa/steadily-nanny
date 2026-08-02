/**
 * ShiftChangeRequestQueryService — membership-scoped reads.
 */
import { describe, expect, it, mock } from 'bun:test';
import { ShiftChangeRequestNotFoundError } from '../../../../../src/domains/shift/errors/shiftErrors';
import { ShiftChangeRequestQueryService } from '../../../../../src/domains/shift/services/shiftChangeRequestQueryService';

const changeRequest = {
  id: 'cr1',
  shift_id: 's1',
  requested_by: 'parent-1',
  kind: 'cancel' as const,
  proposed_starts_at: null,
  proposed_ends_at: null,
  message: 'Sorry',
  status: 'pending' as const,
  responded_by: null,
  responded_at: null,
  created_at: 't',
  updated_at: 't',
};

function makeChangeRequestRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findById: mock(async () => changeRequest),
    listByShift: mock(async () => [changeRequest]),
    ...overrides,
  };
}

function makeShiftQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => ({
      id: 's1',
      household_id: 'h1',
      local_date: '2026-08-03',
    })),
    ...overrides,
  };
}

describe('ShiftChangeRequestQueryService.listForShift', () => {
  it('lists change requests after verifying shift membership', async () => {
    const changeRequestRepo = makeChangeRequestRepo();
    const shiftQueries = makeShiftQueries();
    const svc = new ShiftChangeRequestQueryService(
      changeRequestRepo,
      shiftQueries
    );

    const result = await svc.listForShift('parent-1', 's1');

    expect(shiftQueries.getOwned).toHaveBeenCalledWith('parent-1', 's1');
    expect(changeRequestRepo.listByShift).toHaveBeenCalledWith('s1');
    expect(result).toEqual([changeRequest]);
  });
});

describe('ShiftChangeRequestQueryService.getOwned', () => {
  it('returns the request when the caller can access its shift', async () => {
    const svc = new ShiftChangeRequestQueryService(
      makeChangeRequestRepo(),
      makeShiftQueries()
    );
    const result = await svc.getOwned('parent-1', 'cr1');
    expect(result).toEqual(changeRequest);
  });

  it('throws ShiftChangeRequestNotFoundError when the request is missing', async () => {
    const svc = new ShiftChangeRequestQueryService(
      makeChangeRequestRepo({ findById: mock(async () => null) }),
      makeShiftQueries()
    );
    await expect(svc.getOwned('parent-1', 'cr1')).rejects.toBeInstanceOf(
      ShiftChangeRequestNotFoundError
    );
  });

  it('throws ShiftChangeRequestNotFoundError when shift membership fails', async () => {
    const svc = new ShiftChangeRequestQueryService(
      makeChangeRequestRepo(),
      makeShiftQueries({
        getOwned: mock(async () => {
          throw new Error('no access');
        }),
      })
    );
    await expect(svc.getOwned('parent-1', 'cr1')).rejects.toBeInstanceOf(
      ShiftChangeRequestNotFoundError
    );
  });
});
