/**
 * The household holiday calendar, service layer (3-E4).
 *
 * Reads are member-wide on purpose — what the family observes is a term of the
 * nanny's employment. Writes are the same owner/parent gate every other
 * household setting uses. Both refusals come from classes the domain already
 * has: `HouseholdNotFoundError` (opaque 404, missing-or-not-yours) and
 * `NotAHouseholdParentError`.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { US_FEDERAL_HOLIDAY_KEYS } from '@steadily-nanny/shared-types/usFederalHolidays';
import {
  HouseholdNotFoundError,
  NotAHouseholdParentError,
} from '../../../../../src/domains/household/errors/householdErrors';

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let HouseholdQueryService: typeof import('../../../../../src/domains/household/services/householdQueryService').HouseholdQueryService;
let HouseholdCommandService: typeof import('../../../../../src/domains/household/services/householdCommandService').HouseholdCommandService;

beforeAll(async () => {
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents: mock(() => undefined),
    notifyUser: mock(() => undefined),
  }));

  ({ HouseholdQueryService } = await import(
    '../../../../../src/domains/household/services/householdQueryService'
  ));
  ({ HouseholdCommandService } = await import(
    '../../../../../src/domains/household/services/householdCommandService'
  ));
});

// BOTH timestamp serialisations across this file's fixtures (GOLDEN-FIXES #25).
function holiday(
  holiday_key: string,
  observed: boolean,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `id-${holiday_key}`,
    household_id: HOUSEHOLD_ID,
    holiday_key,
    observed,
    created_at: '2026-08-11T09:00:00+00:00',
    updated_at: '2026-08-11T09:00:00.000Z',
    ...overrides,
  };
}

function makeHolidayRepo(
  rows = [holiday('independence_day', true), holiday('labor_day', false)]
) {
  return {
    listForHousehold: mock(async () => rows),
    upsertMany: mock(async () => rows),
    seedFederalSet: mock(async () => rows),
  };
}

function makeMemberRepo(role: string | null) {
  return {
    findActiveMembership: mock(async () =>
      role === null
        ? null
        : {
            id: 'm1',
            household_id: HOUSEHOLD_ID,
            user_id: 'u1',
            role,
            can_edit: role !== 'nanny',
            status: 'active',
          }
    ),
  };
}

function makeQueries(role: string | null) {
  return new HouseholdQueryService(
    { findById: mock(async () => ({ id: HOUSEHOLD_ID })) } as never,
    makeMemberRepo(role) as never,
    {} as never,
    makeHolidayRepo() as never
  );
}

describe('HouseholdQueryService.listHolidays', () => {
  it('lets a nanny read the calendar — it is a term of her employment', async () => {
    const holidayRepo = makeHolidayRepo();
    const svc = new HouseholdQueryService(
      { findById: mock(async () => ({ id: HOUSEHOLD_ID })) } as never,
      makeMemberRepo('nanny') as never,
      {} as never,
      holidayRepo as never
    );

    const rows = await svc.listHolidays('nanny-1', HOUSEHOLD_ID);

    expect(rows).toHaveLength(2);
    expect(holidayRepo.listForHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('404s a non-member with the domain-wide opaque error, and never reads', async () => {
    const holidayRepo = makeHolidayRepo();
    const svc = new HouseholdQueryService(
      { findById: mock(async () => ({ id: HOUSEHOLD_ID })) } as never,
      makeMemberRepo(null) as never,
      {} as never,
      holidayRepo as never
    );

    await expect(
      svc.listHolidays('stranger', HOUSEHOLD_ID)
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);
    expect(holidayRepo.listForHousehold).not.toHaveBeenCalled();
  });
});

describe('HouseholdCommandService.setHolidays', () => {
  function makeService(role: string, holidayRepo = makeHolidayRepo()) {
    const svc = new HouseholdCommandService(
      { create: mock(), update: mock(), delete: mock() } as never,
      makeMemberRepo(role) as never,
      {} as never,
      makeQueries(role) as never,
      { ensureProfile: mock(async () => {}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      holidayRepo as never
    );
    return { svc, holidayRepo };
  }

  it('lets a parent set toggles and returns the FULL post-write list', async () => {
    const { svc, holidayRepo } = makeService('parent');

    const rows = await svc.setHolidays('parent-1', HOUSEHOLD_ID, {
      holidays: [{ holiday_key: 'labor_day', observed: true }],
    });

    expect(holidayRepo.upsertMany).toHaveBeenCalledWith(HOUSEHOLD_ID, [
      { holiday_key: 'labor_day', observed: true },
    ]);
    // The upsert returns only the rows it touched; the response envelope is the
    // whole calendar, so the write is followed by a full read.
    expect(holidayRepo.listForHousehold).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(rows).toHaveLength(2);
  });

  it('leaves keys the payload never names alone', async () => {
    const { svc, holidayRepo } = makeService('owner');

    await svc.setHolidays('owner-1', HOUSEHOLD_ID, {
      holidays: [{ holiday_key: 'columbus_day', observed: false }],
    });

    // No delete-then-insert, and nothing but the named key reaches the write.
    expect(holidayRepo.upsertMany).toHaveBeenCalledWith(HOUSEHOLD_ID, [
      { holiday_key: 'columbus_day', observed: false },
    ]);
    expect(holidayRepo).not.toHaveProperty('deleteForHousehold');
  });

  it('refuses a nanny — the calendar is parent-configurable (D-12)', async () => {
    const { svc, holidayRepo } = makeService('nanny');

    await expect(
      svc.setHolidays('nanny-1', HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'labor_day', observed: true }],
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(holidayRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('refuses a helper', async () => {
    const { svc, holidayRepo } = makeService('helper');

    await expect(
      svc.setHolidays('helper-1', HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'labor_day', observed: true }],
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(holidayRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('404s a non-member before the role gate can leak that the household exists', async () => {
    const holidayRepo = makeHolidayRepo();
    const svc = new HouseholdCommandService(
      { create: mock(), update: mock(), delete: mock() } as never,
      makeMemberRepo(null) as never,
      {} as never,
      makeQueries(null) as never,
      { ensureProfile: mock(async () => {}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      holidayRepo as never
    );

    await expect(
      svc.setHolidays('stranger', HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'labor_day', observed: true }],
      })
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);
    expect(holidayRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('accepts the whole federal set in one call', async () => {
    const { svc, holidayRepo } = makeService('parent');

    await svc.setHolidays('parent-1', HOUSEHOLD_ID, {
      holidays: US_FEDERAL_HOLIDAY_KEYS.map(holiday_key => ({
        holiday_key,
        observed: true,
      })),
    });

    expect(
      (holidayRepo.upsertMany.mock.calls[0] as unknown[])[1] as unknown[]
    ).toHaveLength(US_FEDERAL_HOLIDAY_KEYS.length);
  });
});
