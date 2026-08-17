/**
 * @module tests/unit/domains/shift/services/shiftQueryService.readScope.test
 *
 * S1 — the service half of migration 103. `assertMember` granted every ACTIVE
 * member household-wide scope without looking at the role, so a second nanny
 * and a helper both read the whole calendar and the whole day thread. This
 * pins the replacement: `assertShiftReader` resolves by ROLE first —
 * owner/parent household-wide, a nanny her OWN shifts only (forced), a helper
 * nothing at all.
 *
 * The two 404s are asserted on the SERIALISED error, not just the class: the
 * whole privacy argument is that a nanny asking about another carer's shift
 * gets byte-identical output to a nanny asking about a shift that does not
 * exist. An instanceof check cannot see the difference; this can.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { ShiftNotFoundError } from '../../../../../src/domains/shift/errors/shiftErrors';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

let ShiftQueryService: typeof import('../../../../../src/domains/shift/services/shiftQueryService').ShiftQueryService;

beforeAll(async () => {
  mock.module(
    '../../../../../src/domains/child/services/uncoveredCareService',
    () => ({
      uncoveredCareService: { raiseUncoveredOnce: mock(async () => []) },
    })
  );
  ({ ShiftQueryService } = await import(
    '../../../../../src/domains/shift/services/shiftQueryService'
  ));
});

const N1 = 'nanny-1';
const N2 = 'nanny-2';
const P1 = 'parent-1';
const H1 = 'helper-1';
const HOUSEHOLD = 'h1';

function makeShift(
  id: string,
  carerId: string | null,
  overrides: Partial<ShiftWithChildren> = {}
): ShiftWithChildren {
  return {
    id,
    household_id: HOUSEHOLD,
    carer_id: carerId,
    starts_at: '2026-08-03T08:00:00.000Z',
    ends_at: '2026-08-03T17:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-08-03',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: null,
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: `uid-${id}`,
    sequence: 0,
    created_by: null,
    created_at: 't',
    updated_at: 't',
    shift_children: [],
    ...overrides,
  } as ShiftWithChildren;
}

const n1Shift = makeShift('s-n1', N1);
const n2Shift = makeShift('s-n2', N2);
const unassignedShift = makeShift('s-none', null);
const parentCover = makeShift('s-cover', null, { kind: 'parent_cover' });
const allShifts = [n1Shift, n2Shift, unassignedShift, parentCover];

const ROLE_BY_USER: Record<string, string> = {
  [P1]: 'parent',
  [N1]: 'nanny',
  [N2]: 'nanny',
  [H1]: 'helper',
};

/** Membership lookup keyed on the caller, so one repo serves the whole matrix. */
function makeMemberRepo(): any {
  return {
    findActiveMembership: mock(async (_householdId: string, userId: string) => {
      const role = ROLE_BY_USER[userId];
      return role ? { id: `m-${userId}`, user_id: userId, role } : null;
    }),
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdAndRange: mock(async () => allShifts),
    findByHouseholdAndLocalDate: mock(async () => allShifts),
    findByIdWithChildren: mock(
      async (id: string) => allShifts.find(s => s.id === id) ?? null
    ),
    findByIds: mock(async (ids: string[]) =>
      allShifts.filter(s => ids.includes(s.id))
    ),
    ...overrides,
  };
}

const events = [
  { id: 'e-n1', household_id: HOUSEHOLD, shift_id: 's-n1', actor_id: P1 },
  { id: 'e-n2', household_id: HOUSEHOLD, shift_id: 's-n2', actor_id: P1 },
  { id: 'e-late', household_id: HOUSEHOLD, shift_id: 's-n2', actor_id: N1 },
  { id: 'e-day', household_id: HOUSEHOLD, shift_id: null, actor_id: null },
];

function makeEventRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listForShift: mock(async (_h: string, shiftId: string) =>
      events.filter(e => e.shift_id === shiftId)
    ),
    listForHouseholdDate: mock(async () => events),
    ...overrides,
  };
}

function svcFor(shiftRepo = makeShiftRepo()) {
  return new ShiftQueryService(shiftRepo, makeEventRepo(), makeMemberRepo());
}

/** Everything a caller can see of a thrown error — stack excluded. */
function serialised(error: unknown) {
  const e = error as ShiftNotFoundError;
  return {
    name: e.name,
    code: e.code,
    message: e.message,
    statusCode: e.statusCode,
    metadata: e.metadata,
  };
}

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('expected the call to reject');
  } catch (error) {
    return serialised(error);
  }
}

const NOT_A_READER = serialised(
  new ShiftNotFoundError(HOUSEHOLD, { reason: 'household_not_accessible' })
);

describe('assertShiftReader — listForHousehold', () => {
  it('gives a parent every shift in the household', async () => {
    expect(await svcFor().listForHousehold(P1, HOUSEHOLD, 'a', 'b')).toEqual(
      allShifts
    );
  });

  it('gives a nanny ONLY her own shifts — not the other carer, not the unassigned ones', async () => {
    expect(await svcFor().listForHousehold(N1, HOUSEHOLD, 'a', 'b')).toEqual([
      n1Shift,
    ]);
  });

  it('gives the second nanny only hers', async () => {
    expect(await svcFor().listForHousehold(N2, HOUSEHOLD, 'a', 'b')).toEqual([
      n2Shift,
    ]);
  });

  it('refuses a helper with the same error a non-member gets', async () => {
    expect(
      await caught(svcFor().listForHousehold(H1, HOUSEHOLD, 'a', 'b'))
    ).toEqual(NOT_A_READER);
    expect(
      await caught(svcFor().listForHousehold('stranger', HOUSEHOLD, 'a', 'b'))
    ).toEqual(NOT_A_READER);
  });
});

describe('assertShiftReader — getOwned', () => {
  it('lets a parent read any shift in the household', async () => {
    expect(await svcFor().getOwned(P1, 's-n2')).toEqual(n2Shift);
  });

  it('lets a nanny read her own', async () => {
    expect(await svcFor().getOwned(N1, 's-n1')).toEqual(n1Shift);
  });

  it("404s a nanny on another carer's shift, byte-identically to a missing one", async () => {
    const otherCarer = await caught(svcFor().getOwned(N1, 's-n2'));
    const missing = await caught(
      svcFor(
        makeShiftRepo({ findByIdWithChildren: mock(async () => null) })
      ).getOwned(N1, 's-n2')
    );
    expect(otherCarer).toEqual(missing);
    expect(otherCarer).toEqual(serialised(new ShiftNotFoundError('s-n2')));
  });

  it('404s a nanny on an unassigned shift and on parent cover', async () => {
    expect(await caught(svcFor().getOwned(N1, 's-none'))).toEqual(
      serialised(new ShiftNotFoundError('s-none'))
    );
    expect(await caught(svcFor().getOwned(N1, 's-cover'))).toEqual(
      serialised(new ShiftNotFoundError('s-cover'))
    );
  });

  it('404s a helper with the shift-id form, not the household form', async () => {
    expect(await caught(svcFor().getOwned(H1, 's-n1'))).toEqual(
      serialised(new ShiftNotFoundError('s-n1'))
    );
  });
});

describe('assertShiftReader — listEvents goes through getOwned', () => {
  it('lets a nanny read her own shift’s thread', async () => {
    const result = await svcFor().listEvents(N1, HOUSEHOLD, 's-n1');
    expect(result.map(e => e.id)).toEqual(['e-n1']);
  });

  it("404s a nanny on another carer's shift thread", async () => {
    expect(await caught(svcFor().listEvents(N1, HOUSEHOLD, 's-n2'))).toEqual(
      serialised(new ShiftNotFoundError('s-n2'))
    );
  });

  it('404s when the shift belongs to a different household than the URL', async () => {
    const repo = makeShiftRepo({
      findByIdWithChildren: mock(async () => ({
        ...n1Shift,
        household_id: 'other-household',
      })),
    });
    expect(
      await caught(svcFor(repo).listEvents(N1, HOUSEHOLD, 's-n1'))
    ).toEqual(serialised(new ShiftNotFoundError('s-n1')));
  });
});

describe('assertShiftReader — listDayThread', () => {
  it('gives a parent the whole thread, day-level rows included', async () => {
    const result = await svcFor().listDayThread(P1, HOUSEHOLD, '2026-08-03');
    expect(result.map(e => e.id)).toEqual(['e-n1', 'e-n2', 'e-late', 'e-day']);
  });

  it('gives a nanny her own shifts’ rows plus rows she wrote — never the day-level ones', async () => {
    const result = await svcFor().listDayThread(N1, HOUSEHOLD, '2026-08-03');
    expect(result.map(e => e.id)).toEqual(['e-n1', 'e-late']);
  });

  it('gives the second nanny every row on HER shift, whoever wrote it', async () => {
    const result = await svcFor().listDayThread(N2, HOUSEHOLD, '2026-08-03');
    expect(result.map(e => e.id)).toEqual(['e-n2', 'e-late']);
  });

  it('refuses a helper', async () => {
    expect(
      await caught(svcFor().listDayThread(H1, HOUSEHOLD, '2026-08-03'))
    ).toEqual(NOT_A_READER);
  });
});
