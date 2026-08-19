/**
 * A new household is seeded with the federal holiday set at creation (080's
 * "why the seed is not a trigger"). That seed is what makes the Holidays group
 * read "all on" the first time a parent opens it — absence means NOT observed,
 * so without the seed a brand-new family would silently observe nothing.
 *
 * The failure mode is the interesting half: a family with no holiday rows is a
 * valid, recoverable state (every toggle is one PUT away), a family with no
 * HOUSEHOLD is not. So the seed is logged-and-swallowed, unlike the owner
 * membership insert right above it, which rolls the household back.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_TS = new Date(Date.now() - 2 * DAY_MS).toISOString();
const FIXTURE_TS_OFFSET = FIXTURE_TS.replace('.000Z', '+00:00');

function makeHouseholdRepo(overrides: Record<string, unknown> = {}) {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'h-new',
      country: 'US',
      ...data,
      // Both serialisations across this file's fixtures (GOLDEN-FIXES #25).
      created_at: FIXTURE_TS_OFFSET,
      updated_at: FIXTURE_TS,
    })),
    update: mock(),
    delete: mock(async () => undefined),
    findById: mock(async () => ({ id: 'h-new' })),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}) {
  return {
    createMembership: mock(async (data: Record<string, unknown>) => ({
      id: 'm-new',
      ...data,
    })),
    findActiveMembership: mock(async () => null),
    // §8's one-live-household-per-parent guard reads this before the create.
    // Empty: these fixtures are about the holiday seed, not about the cap.
    listActiveByUser: mock(async () => []),
    ...overrides,
  };
}

function makeService(
  holidayRepo: Record<string, unknown>,
  memberRepo = makeMemberRepo(),
  householdRepo = makeHouseholdRepo()
) {
  const svc = new HouseholdCommandService(
    householdRepo as never,
    memberRepo as never,
    {} as never,
    { getMembership: mock() } as never,
    { ensureProfile: mock(async () => {}) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    holidayRepo as never
  );
  return { svc, householdRepo, memberRepo };
}

describe('HouseholdCommandService.create — holiday seed', () => {
  it('seeds the country pack for the new household', async () => {
    const holidayRepo = { seedCountryPack: mock(async () => []) };
    const { svc } = makeService(holidayRepo);

    const household = await svc.create('u1', { name: 'The Smiths' });

    expect(household.id).toBe('h-new');
    expect(holidayRepo.seedCountryPack).toHaveBeenCalledWith('h-new', 'US');
  });

  it('seeds the Canadian pack when the household’s country is CA', async () => {
    const holidayRepo = { seedCountryPack: mock(async () => []) };
    const { svc } = makeService(holidayRepo);

    await svc.create('u1', { name: 'The Smiths', country: 'CA' });

    expect(holidayRepo.seedCountryPack).toHaveBeenCalledWith('h-new', 'CA');
  });

  it('still returns the household when the seed fails, and logs it', async () => {
    loggerError.mockClear();
    const holidayRepo = {
      seedCountryPack: mock(async () => {
        throw new Error('database exploded');
      }),
    };
    const { svc, householdRepo } = makeService(holidayRepo);

    const household = await svc.create('u1', { name: 'The Smiths' });

    expect(household.id).toBe('h-new');
    // NOT rolled back — a household with no holiday rows is recoverable.
    expect(householdRepo.delete).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalled();
    expect(holidayRepo.seedCountryPack).toHaveBeenCalled();
  });

  it('never seeds when the owner-membership insert failed and the household was rolled back', async () => {
    const holidayRepo = { seedCountryPack: mock(async () => []) };
    const memberRepo = makeMemberRepo({
      createMembership: mock(async () => {
        throw new Error('membership insert failed');
      }),
    });
    const { svc, householdRepo } = makeService(holidayRepo, memberRepo);

    await expect(svc.create('u1', { name: 'The Smiths' })).rejects.toThrow(
      'membership insert failed'
    );
    expect(householdRepo.delete).toHaveBeenCalledWith('h-new');
    expect(holidayRepo.seedCountryPack).not.toHaveBeenCalled();
  });
});
