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
  UnknownHolidayKeyError,
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

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

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
    created_at: FIXTURE_TS_OFFSET,
    updated_at: FIXTURE_TS,
    ...overrides,
  };
}

function makeHolidayRepo(
  rows = [holiday('independence_day', true), holiday('labor_day', false)]
) {
  return {
    listForHousehold: mock(async () => rows),
    upsertMany: mock(async () => rows),
    seedCountryPack: mock(async () => rows),
    deleteKeysNotIn: mock(async () => undefined),
  };
}

function makeCustomHolidayRepo(
  rows: Array<{ name: string; dates: string[] }> = []
) {
  return {
    listForHousehold: mock(async () => rows),
    replaceSet: mock(async () => rows),
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
  function makeService(
    role: string,
    holidayRepo = makeHolidayRepo(),
    country = 'US',
    customHolidayRepo = makeCustomHolidayRepo()
  ) {
    const householdRepo = {
      create: mock(),
      update: mock(),
      delete: mock(),
      findById: mock(async () => ({ id: HOUSEHOLD_ID, country })),
    };
    const svc = new HouseholdCommandService(
      householdRepo as never,
      makeMemberRepo(role) as never,
      {} as never,
      makeQueries(role) as never,
      { ensureProfile: mock(async () => {}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      holidayRepo as never,
      {} as never,
      customHolidayRepo as never
    );
    return { svc, holidayRepo, householdRepo, customHolidayRepo };
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
    const stranger = new HouseholdCommandService(
      {
        create: mock(),
        update: mock(),
        delete: mock(),
        findById: mock(),
      } as never,
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
      stranger.setHolidays('stranger', HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'labor_day', observed: true }],
      })
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);
    expect(holidayRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('refuses a key outside the household’s country pack with HTTP 400', async () => {
    const { svc, holidayRepo } = makeService('parent', makeHolidayRepo(), 'US');

    await expect(
      svc.setHolidays('parent-1', HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'canada_day', observed: true }],
      })
    ).rejects.toBeInstanceOf(UnknownHolidayKeyError);
    await expect(
      svc.setHolidays('parent-1', HOUSEHOLD_ID, {
        holidays: [{ holiday_key: 'canada_day', observed: true }],
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(holidayRepo.upsertMany).not.toHaveBeenCalled();
  });

  it('accepts a key that belongs to the household’s country pack', async () => {
    const { svc, holidayRepo } = makeService('parent', makeHolidayRepo(), 'CA');

    await svc.setHolidays('parent-1', HOUSEHOLD_ID, {
      holidays: [{ holiday_key: 'canada_day', observed: true }],
    });

    expect(holidayRepo.upsertMany).toHaveBeenCalledWith(HOUSEHOLD_ID, [
      { holiday_key: 'canada_day', observed: true },
    ]);
  });

  it('refuses the whole request when any named key is outside the pack', async () => {
    const { svc, holidayRepo } = makeService('parent', makeHolidayRepo(), 'US');

    await expect(
      svc.setHolidays('parent-1', HOUSEHOLD_ID, {
        holidays: [
          { holiday_key: 'labor_day', observed: true },
          { holiday_key: 'boxing_day', observed: true },
        ],
      })
    ).rejects.toBeInstanceOf(UnknownHolidayKeyError);
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

describe('HouseholdQueryService.listCustomHolidays', () => {
  it('lets a nanny read custom days — they are a term of her employment', async () => {
    const customHolidayRepo = makeCustomHolidayRepo([
      { name: 'Diwali', dates: ['2026-11-08'] },
    ]);
    const svc = new HouseholdQueryService(
      { findById: mock(async () => ({ id: HOUSEHOLD_ID })) } as never,
      makeMemberRepo('nanny') as never,
      {} as never,
      makeHolidayRepo() as never,
      {} as never,
      customHolidayRepo as never
    );

    const rows = await svc.listCustomHolidays('nanny-1', HOUSEHOLD_ID);

    expect(rows).toHaveLength(1);
    expect(customHolidayRepo.listForHousehold).toHaveBeenCalledWith(
      HOUSEHOLD_ID
    );
  });

  it('404s a non-member and never reads', async () => {
    const customHolidayRepo = makeCustomHolidayRepo();
    const svc = new HouseholdQueryService(
      { findById: mock(async () => ({ id: HOUSEHOLD_ID })) } as never,
      makeMemberRepo(null) as never,
      {} as never,
      makeHolidayRepo() as never,
      {} as never,
      customHolidayRepo as never
    );

    await expect(
      svc.listCustomHolidays('stranger', HOUSEHOLD_ID)
    ).rejects.toBeInstanceOf(HouseholdNotFoundError);
    expect(customHolidayRepo.listForHousehold).not.toHaveBeenCalled();
  });
});

describe('HouseholdCommandService.setCustomHolidays', () => {
  function makeService(
    role: string,
    customHolidayRepo = makeCustomHolidayRepo()
  ) {
    const svc = new HouseholdCommandService(
      {
        create: mock(),
        update: mock(),
        delete: mock(),
        findById: mock(async () => ({ id: HOUSEHOLD_ID, country: 'US' })),
      } as never,
      makeMemberRepo(role) as never,
      {} as never,
      makeQueries(role) as never,
      { ensureProfile: mock(async () => {}) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      makeHolidayRepo() as never,
      {} as never,
      customHolidayRepo as never
    );
    return { svc, customHolidayRepo };
  }

  it('lets a parent replace the custom-day set, including emptying it', async () => {
    const { svc, customHolidayRepo } = makeService('parent');

    await svc.setCustomHolidays('parent-1', HOUSEHOLD_ID, {
      custom_holidays: [],
    });

    expect(customHolidayRepo.replaceSet).toHaveBeenCalledWith(HOUSEHOLD_ID, []);
  });

  it('refuses a nanny — custom days are parent-configurable', async () => {
    const { svc, customHolidayRepo } = makeService('nanny');

    await expect(
      svc.setCustomHolidays('nanny-1', HOUSEHOLD_ID, {
        custom_holidays: [{ name: 'Diwali', dates: ['2026-11-08'] }],
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(customHolidayRepo.replaceSet).not.toHaveBeenCalled();
  });

  it('refuses a helper', async () => {
    const { svc, customHolidayRepo } = makeService('helper');

    await expect(
      svc.setCustomHolidays('helper-1', HOUSEHOLD_ID, {
        custom_holidays: [{ name: 'Diwali', dates: ['2026-11-08'] }],
      })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(customHolidayRepo.replaceSet).not.toHaveBeenCalled();
  });
});
