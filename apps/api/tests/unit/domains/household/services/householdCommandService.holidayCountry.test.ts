/**
 * Country-pack resync on household update (107). Changing `country` drops
 * keys the new pack does not contain, then seeds the new pack with
 * ignoreDuplicates so a shared key (christmas_day) keeps the family's
 * existing toggle. Custom days are dates, not pack keys — they stay put.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { holidayKeysForCountry } from '@steadily-nanny/shared-types/holidayPacks';

let HouseholdCommandService: typeof import('../../../../../src/domains/household/services/householdCommandService').HouseholdCommandService;
let loggerError: ReturnType<typeof mock>;

beforeAll(async () => {
  loggerError = mock(() => undefined);
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      error: loggerError,
      warn: mock(() => undefined),
      info: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));
  mock.module('../../../../../src/domains/notification', () => ({
    notifyHouseholdParents: mock(() => undefined),
    notifyUser: mock(() => undefined),
  }));

  ({ HouseholdCommandService } = await import(
    '../../../../../src/domains/household/services/householdCommandService'
  ));
});

const HOUSEHOLD_ID = 'h1';

function membership(role: string) {
  return {
    id: 'm1',
    household_id: HOUSEHOLD_ID,
    user_id: 'u1',
    role,
    can_edit: role !== 'nanny',
    status: 'active',
  };
}

function makeHolidayRepo() {
  return {
    upsertMany: mock(async () => []),
    listForHousehold: mock(async () => []),
    seedCountryPack: mock(async () => []),
    deleteKeysNotIn: mock(async () => undefined),
  };
}

function makeCustomHolidayRepo() {
  return {
    listForHousehold: mock(async () => []),
    replaceSet: mock(async () => []),
  };
}

function makeService(
  opts: {
    country?: string;
    weekStartsOn?: number;
    holidayRepo?: ReturnType<typeof makeHolidayRepo>;
    customHolidayRepo?: ReturnType<typeof makeCustomHolidayRepo>;
    role?: string;
  } = {}
) {
  const holidayRepo = opts.holidayRepo ?? makeHolidayRepo();
  const customHolidayRepo = opts.customHolidayRepo ?? makeCustomHolidayRepo();
  const current = {
    id: HOUSEHOLD_ID,
    country: opts.country ?? 'US',
    week_starts_on: opts.weekStartsOn ?? 1,
  };
  const householdRepo = {
    findById: mock(async () => current),
    update: mock(async (_id: string, data: Record<string, unknown>) => ({
      ...current,
      ...data,
    })),
  };
  const svc = new HouseholdCommandService(
    householdRepo as never,
    {} as never,
    {} as never,
    {
      getMembership: mock(async () => membership(opts.role ?? 'parent')),
    } as never,
    { ensureProfile: mock(async () => {}) } as never,
    {} as never,
    {} as never,
    {} as never,
    { existsForHousehold: mock(async () => false) } as never,
    holidayRepo as never,
    {} as never,
    customHolidayRepo as never
  );
  return { svc, householdRepo, holidayRepo, customHolidayRepo };
}

describe('HouseholdCommandService.update — country change resyncs the pack', () => {
  it('deletes keys not in the new pack, then seeds it, leaving shared keys alone', async () => {
    const callOrder: string[] = [];
    const holidayRepo = makeHolidayRepo();
    holidayRepo.deleteKeysNotIn.mockImplementation(async () => {
      callOrder.push('delete');
    });
    holidayRepo.seedCountryPack.mockImplementation(async () => {
      callOrder.push('seed');
      return [];
    });
    const { svc, householdRepo, customHolidayRepo } = makeService({
      country: 'US',
      holidayRepo,
    });

    const updated = await svc.update('u1', HOUSEHOLD_ID, { country: 'CA' });

    expect(updated.country).toBe('CA');
    expect(householdRepo.update).toHaveBeenCalledWith(HOUSEHOLD_ID, {
      country: 'CA',
    });
    const caKeys = holidayKeysForCountry('CA');
    expect(caKeys).toContain('christmas_day');
    expect(caKeys).not.toContain('independence_day');
    expect(holidayRepo.deleteKeysNotIn).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      caKeys
    );
    expect(holidayRepo.seedCountryPack).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      'CA'
    );
    expect(callOrder).toEqual(['delete', 'seed']);
    expect(holidayRepo.upsertMany).not.toHaveBeenCalled();
    expect(customHolidayRepo.replaceSet).not.toHaveBeenCalled();
  });

  it('does not resync when country is unchanged', async () => {
    const { svc, holidayRepo } = makeService({ country: 'US' });

    await svc.update('u1', HOUSEHOLD_ID, { country: 'US' });

    expect(holidayRepo.deleteKeysNotIn).not.toHaveBeenCalled();
    expect(holidayRepo.seedCountryPack).not.toHaveBeenCalled();
  });

  it('does not read the current row when neither country nor week_starts_on is present', async () => {
    const { svc, householdRepo, holidayRepo } = makeService();

    await svc.update('u1', HOUSEHOLD_ID, { name: 'The Bakers' });

    expect(householdRepo.findById).not.toHaveBeenCalled();
    expect(holidayRepo.seedCountryPack).not.toHaveBeenCalled();
  });

  it('reads the current row once when country is present without week_starts_on', async () => {
    const { svc, householdRepo } = makeService({ country: 'US' });

    await svc.update('u1', HOUSEHOLD_ID, { country: 'CA' });

    expect(householdRepo.findById).toHaveBeenCalledTimes(1);
  });

  it('logs a seed failure and still returns the updated household', async () => {
    loggerError.mockClear();
    const holidayRepo = makeHolidayRepo();
    holidayRepo.seedCountryPack.mockImplementation(async () => {
      throw new Error('seed exploded');
    });
    const { svc } = makeService({ country: 'US', holidayRepo });

    const updated = await svc.update('u1', HOUSEHOLD_ID, { country: 'CA' });

    expect(updated.country).toBe('CA');
    expect(loggerError).toHaveBeenCalled();
  });
});
