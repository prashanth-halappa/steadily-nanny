import { describe, expect, it, mock } from 'bun:test';
import { AvailabilityNotFoundError } from '../../../../../src/domains/availability/errors/availabilityErrors';
import { AvailabilityQueryService } from '../../../../../src/domains/availability/services/availabilityQueryService';
import type {
  AnonymisedBusyBlock,
  CarerAvailability,
} from '../../../../../src/domains/availability/types';

const rows: CarerAvailability[] = [
  {
    id: 'a1',
    user_id: 'carer-1',
    weekday: 1,
    is_available: true,
    earliest_start: '09:00:00',
    latest_finish: '17:00:00',
    evening_mode: 'never',
    created_at: 't',
    updated_at: 't',
  },
];

const busyBlocks: AnonymisedBusyBlock[] = [
  {
    starts_at: '2026-08-03T09:00:00Z',
    ends_at: '2026-08-03T13:00:00Z',
    kind: 'other_commitment',
  },
];

function makeAvailabilityRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByUserId: mock(async () => rows),
    ...overrides,
  };
}

function makeBusyBlockRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForCarer: mock(async () => busyBlocks),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listActiveHouseholdIds: mock(async (userId: string) =>
      userId === 'carer-1' || userId === 'parent-1' ? ['h1'] : ['h2']
    ),
    ...overrides,
  };
}

describe('AvailabilityQueryService.listOwn', () => {
  it("returns the caller's own weekday rows", async () => {
    const availabilityRepo = makeAvailabilityRepo();
    const svc = new AvailabilityQueryService(
      availabilityRepo,
      makeBusyBlockRepo(),
      makeMemberRepo()
    );
    expect(await svc.listOwn('carer-1')).toEqual(rows);
    expect(availabilityRepo.findByUserId).toHaveBeenCalledWith('carer-1');
  });
});

describe('AvailabilityQueryService.listForUser', () => {
  it('returns the target availability when the caller shares an active household', async () => {
    const svc = new AvailabilityQueryService(
      makeAvailabilityRepo(),
      makeBusyBlockRepo(),
      makeMemberRepo()
    );
    expect(await svc.listForUser('parent-1', 'carer-1')).toEqual(rows);
  });

  it('throws AvailabilityNotFoundError when the caller does NOT share a household with the target', async () => {
    const svc = new AvailabilityQueryService(
      makeAvailabilityRepo(),
      makeBusyBlockRepo(),
      makeMemberRepo({
        listActiveHouseholdIds: mock(async (userId: string) =>
          userId === 'carer-1' ? ['h1'] : ['h-other']
        ),
      })
    );
    await expect(svc.listForUser('stranger', 'carer-1')).rejects.toBeInstanceOf(
      AvailabilityNotFoundError
    );
  });

  it('throws the SAME AvailabilityNotFoundError when the target user does not exist at all (no existence leak)', async () => {
    const svc = new AvailabilityQueryService(
      makeAvailabilityRepo(),
      makeBusyBlockRepo(),
      makeMemberRepo({
        listActiveHouseholdIds: mock(async (userId: string) =>
          userId === 'stranger' ? ['h-other'] : []
        ),
      })
    );
    await expect(
      svc.listForUser('stranger', 'does-not-exist')
    ).rejects.toBeInstanceOf(AvailabilityNotFoundError);
  });
});

describe('AvailabilityQueryService.listBusyBlocks', () => {
  it('returns busy blocks when the caller shares a household with the carer', async () => {
    const busyBlockRepo = makeBusyBlockRepo();
    const svc = new AvailabilityQueryService(
      makeAvailabilityRepo(),
      busyBlockRepo,
      makeMemberRepo()
    );
    const result = await svc.listBusyBlocks(
      'parent-1',
      'carer-1',
      '2026-08-01T00:00:00Z',
      '2026-08-07T23:59:59Z'
    );
    expect(result).toEqual(busyBlocks);
    expect(busyBlockRepo.listForCarer).toHaveBeenCalledWith(
      'carer-1',
      '2026-08-01T00:00:00Z',
      '2026-08-07T23:59:59Z'
    );
  });

  it('throws AvailabilityNotFoundError — and never queries busy blocks — for a caller with no shared household', async () => {
    const busyBlockRepo = makeBusyBlockRepo();
    const svc = new AvailabilityQueryService(
      makeAvailabilityRepo(),
      busyBlockRepo,
      makeMemberRepo({
        listActiveHouseholdIds: mock(async (userId: string) =>
          userId === 'carer-1' ? ['h1'] : ['h-other']
        ),
      })
    );
    await expect(
      svc.listBusyBlocks(
        'stranger',
        'carer-1',
        '2026-08-01T00:00:00Z',
        '2026-08-07T23:59:59Z'
      )
    ).rejects.toBeInstanceOf(AvailabilityNotFoundError);
    expect(busyBlockRepo.listForCarer).not.toHaveBeenCalled();
  });
});
