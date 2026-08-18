/**
 * Account deletion tears down what leaving leaves behind.
 *
 * `removeMember` / `leave` have always done this properly — end the pay
 * arrangement, refuse to strand a running clock, refuse to orphan the
 * household by removing its owner. `deleteUser` did none of it: it deleted
 * the profile row and the auth user and let the FKs sort themselves out. They
 * don't. Every FK pointing at a departing user is `on delete set null` (033's
 * discipline), so what actually survived a deletion was live pay terms with
 * no carer, an `accepted` schedule pattern minting confirmed carer-less ghost
 * shifts to the horizon forever, a `running` time entry nobody can close,
 * change requests sitting in an inbox with no counterparty, and — when the
 * owner was the one leaving — a household nobody could write to.
 *
 * DELETION NEVER REFUSES. App Store 5.1.1(v) requires in-app deletion and
 * `REVIEW-CHECKLIST.md` records it as closed and verified, so each of
 * `removeMember`'s guards becomes a teardown STEP here, never a refusal.
 *
 * ORDER IS THE WHOLE TRICK: the membership rows cascade away with the profile
 * (`household_members.user_id` is `on delete cascade`, deliberately — 033's
 * header), and every other row merely loses its `carer_id`. So the household
 * list is captured FIRST and every step runs BEFORE the profile delete.
 *
 * @module tests/unit/domains/user/services/userService.deleteUser
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let UserService: any;
let logger: any;

// --- fixture state, reset per test -----------------------------------------

interface Row {
  [key: string]: unknown;
}

let memberships: Row[] = [];
let households: Row[] = [];
let rosters: Record<string, Row[]> = {};
let acceptedPatterns: Record<string, Row[]> = {};
let runningEntry: Row | null = null;
let failures: Record<string, boolean> = {};

/** Everything the teardown did, in the order it did it. */
let trace: { step: string; args: unknown[] }[] = [];

const record = (step: string, ...args: unknown[]) => {
  trace.push({ step, args });
};
const stepNames = () => trace.map(entry => entry.step);
const argsFor = (step: string) =>
  trace.filter(entry => entry.step === step).map(entry => entry.args);

function member(overrides: Row = {}): Row {
  return {
    id: 'm-self',
    household_id: 'h1',
    user_id: 'u1',
    role: 'nanny',
    status: 'active',
    joined_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  mock.module('../../../../../src/config/supabase', () => {
    const chain: any = {
      select: mock(() => chain),
      update: mock((patch: Record<string, unknown>) => {
        record('changeRequests.update', patch);
        return chain;
      }),
      delete: mock(() => {
        record('profile.delete');
        return chain;
      }),
      eq: mock((key: string, value: unknown) => {
        record('filter', key, value);
        return chain;
      }),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
      then: (resolve: any) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    const obj = {
      from: mock((table: string) => {
        record(`from:${table}`);
        return chain;
      }),
      auth: {
        admin: {
          deleteUser: mock(async () => {
            record('auth.delete');
            return { error: null };
          }),
        },
      },
    };
    return { supabase: obj, supabaseService: obj };
  });

  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: { info: mock(), error: mock(), warn: mock(), debug: mock() },
  }));

  mock.module(
    '../../../../../src/domains/household/repositories/householdMemberRepository',
    () => ({
      HouseholdMemberRepository: class {
        async listByUser(userId: string) {
          record('members.listByUser', userId);
          if (failures.listMemberships) {
            throw new Error('membership read exploded');
          }
          return memberships;
        }
        async listActiveByHousehold(householdId: string) {
          return rosters[householdId] ?? [];
        }
        async update(id: string, patch: Row) {
          record('members.update', id, patch);
          return { ...member(), id, ...patch };
        }
      },
    })
  );

  mock.module(
    '../../../../../src/domains/household/repositories/householdRepository',
    () => ({
      HouseholdRepository: class {
        async findByIds(ids: string[]) {
          return households.filter(h => ids.includes(h.id as string));
        }
        async deleteIfMemberless(ids: string[]) {
          record('households.deleteIfMemberless', ids);
          if (failures.reap) {
            throw new Error('reaper exploded');
          }
          return ids;
        }
      },
    })
  );

  mock.module(
    '../../../../../src/domains/pay/repositories/payArrangementRepository',
    () => ({
      PayArrangementRepository: class {
        async endForCarer(householdId: string, carerId: string, endOn: string) {
          record('pay.endForCarer', householdId, carerId, endOn);
          if (failures.pay) {
            throw new Error('pay exploded');
          }
          return [];
        }
      },
    })
  );

  mock.module(
    '../../../../../src/domains/termsProposal/repositories/termsProposalRepository',
    () => ({
      TermsProposalRepository: class {
        async withdrawOpenForCarer(householdId: string, carerId: string) {
          record('proposals.withdrawOpenForCarer', householdId, carerId);
          if (failures.withdrawProposals) {
            throw new Error('withdraw exploded');
          }
          return { id: 'tp-1', status: 'withdrawn' };
        }
      },
    })
  );

  mock.module(
    '../../../../../src/domains/schedule/repositories/schedulePatternRepository',
    () => ({
      SchedulePatternRepository: class {
        async listAcceptedByHouseholdAndCarer(
          householdId: string,
          carerId: string
        ) {
          record('patterns.list', householdId, carerId);
          return acceptedPatterns[householdId] ?? [];
        }
        async update(id: string, patch: Row) {
          record('patterns.update', id, patch);
          return { id, ...patch };
        }
      },
    })
  );

  mock.module(
    '../../../../../src/domains/schedule/services/scheduleMaterialisationService',
    () => ({
      scheduleMaterialisationService: {
        cancelFutureShiftsForEndedPattern: mock(async (patternId: string) => {
          record('patterns.cancelFuture', patternId);
          return 0;
        }),
      },
    })
  );

  mock.module(
    '../../../../../src/domains/timesheet/repositories/timeEntryRepository',
    () => ({
      TimeEntryRepository: class {
        async findRunningForCarer(carerId: string) {
          record('entries.findRunning', carerId);
          return runningEntry;
        }
      },
    })
  );

  mock.module(
    '../../../../../src/domains/timesheet/services/timesheetCommandService',
    () => ({
      timesheetCommandService: {
        clockOut: mock(async (userId: string, entryId: string) => {
          record('entries.clockOut', userId, entryId);
          if (failures.clockOut) {
            throw new Error('clock-out exploded');
          }
          return {};
        }),
      },
    })
  );

  UserService = (
    await import('../../../../../src/domains/user/services/userService')
  ).UserService;
  logger = (await import('../../../../../src/middlewares/logger')).logger;
});

beforeEach(() => {
  memberships = [member()];
  households = [{ id: 'h1', timezone: 'Europe/London' }];
  rosters = {};
  acceptedPatterns = {};
  runningEntry = null;
  failures = {};
  trace = [];
  logger.error.mockClear?.();
  logger.info.mockClear?.();
});

// ---------------------------------------------------------------------------

describe('UserService.deleteUser — capture before cascade', () => {
  it('reads the memberships before deleting the profile that cascades them away', async () => {
    await UserService.deleteUser('u1');

    const names = stepNames();
    expect(names.indexOf('members.listByUser')).toBeLessThan(
      names.indexOf('profile.delete')
    );
    expect(argsFor('members.listByUser')).toEqual([['u1']]);
  });

  it('still deletes the profile and the auth user, in that order', async () => {
    await UserService.deleteUser('u1');

    const names = stepNames();
    expect(names).toContain('profile.delete');
    expect(names.indexOf('profile.delete')).toBeLessThan(
      names.indexOf('auth.delete')
    );
  });
});

describe('UserService.deleteUser — pay arrangements', () => {
  it('end-dates the carer terms in every household, on the household-local date', async () => {
    memberships = [
      member({ household_id: 'h1' }),
      member({ id: 'm2', household_id: 'h2' }),
    ];
    households = [
      { id: 'h1', timezone: 'Europe/London' },
      { id: 'h2', timezone: 'Pacific/Auckland' },
    ];

    await UserService.deleteUser('u1');

    const calls = argsFor('pay.endForCarer');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.slice(0, 2)).toEqual(['h1', 'u1']);
    expect(calls[1]?.slice(0, 2)).toEqual(['h2', 'u1']);
    // A calendar date, not a timestamp — `valid_to` is a date column.
    expect(calls[0]?.[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ends the terms before the profile delete orphans the carer_id', async () => {
    await UserService.deleteUser('u1');

    const names = stepNames();
    expect(names.indexOf('pay.endForCarer')).toBeLessThan(
      names.indexOf('profile.delete')
    );
  });
});

describe('UserService.deleteUser — open terms proposals (F8)', () => {
  it('withdraws the open round in every household this user carers in', async () => {
    memberships = [
      member({ household_id: 'h1' }),
      member({ id: 'm2', household_id: 'h2' }),
    ];
    households = [
      { id: 'h1', timezone: 'Europe/London' },
      { id: 'h2', timezone: 'Pacific/Auckland' },
    ];

    await UserService.deleteUser('u1');

    expect(argsFor('proposals.withdrawOpenForCarer')).toEqual([
      ['h1', 'u1'],
      ['h2', 'u1'],
    ]);
  });

  it('withdraws before the profile delete orphans the carer_id', async () => {
    await UserService.deleteUser('u1');

    const names = stepNames();
    expect(names.indexOf('proposals.withdrawOpenForCarer')).toBeLessThan(
      names.indexOf('profile.delete')
    );
  });

  it('finishes the deletion when withdrawing a proposal throws', async () => {
    failures.withdrawProposals = true;

    await UserService.deleteUser('u1');

    expect(stepNames()).toContain('auth.delete');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('UserService.deleteUser — schedule patterns', () => {
  it('ends every accepted pattern and withdraws the shifts it already made', async () => {
    acceptedPatterns = { h1: [{ id: 'p1' }, { id: 'p2' }] };

    await UserService.deleteUser('u1');

    expect(argsFor('patterns.update')).toEqual([
      ['p1', { status: 'ended' }],
      ['p2', { status: 'ended' }],
    ]);
    expect(argsFor('patterns.cancelFuture')).toEqual([['p1'], ['p2']]);
  });

  it('asks only for this carer, in this household', async () => {
    await UserService.deleteUser('u1');

    expect(argsFor('patterns.list')).toEqual([['h1', 'u1']]);
  });
});

describe('UserService.deleteUser — running time entry', () => {
  it('closes a running entry instead of refusing the deletion', async () => {
    runningEntry = { id: 'te-1' };

    await UserService.deleteUser('u1');

    expect(argsFor('entries.clockOut')).toEqual([['u1', 'te-1']]);
  });

  it('does nothing when nothing is running', async () => {
    await UserService.deleteUser('u1');

    expect(argsFor('entries.clockOut')).toEqual([]);
  });

  it('closes the entry before the profile delete nulls its carer_id', async () => {
    runningEntry = { id: 'te-1' };

    await UserService.deleteUser('u1');

    const names = stepNames();
    expect(names.indexOf('entries.clockOut')).toBeLessThan(
      names.indexOf('profile.delete')
    );
  });
});

describe('UserService.deleteUser — open change requests', () => {
  it('withdraws them so they stop sitting in inboxes with no counterparty', async () => {
    await UserService.deleteUser('u1');

    expect(stepNames()).toContain('from:shift_change_requests');
    expect(argsFor('changeRequests.update')).toEqual([
      [{ status: 'withdrawn' }],
    ]);
    // Only this user's, and only the ones still open.
    const filters = argsFor('filter');
    expect(filters).toContainEqual(['requested_by', 'u1']);
    expect(filters).toContainEqual(['status', 'pending']);
  });
});

describe('UserService.deleteUser — owner promotion', () => {
  it('promotes the earliest-joined remaining parent when the owner leaves', async () => {
    memberships = [member({ id: 'm-owner', role: 'owner' })];
    rosters = {
      h1: [
        member({ id: 'm-owner', role: 'owner' }),
        member({
          id: 'm-nanny',
          user_id: 'u-nanny',
          role: 'nanny',
          joined_at: '2026-02-01T00:00:00.000Z',
        }),
        member({
          id: 'm-parent-old',
          user_id: 'u-parent-old',
          role: 'parent',
          joined_at: '2026-03-01T00:00:00.000Z',
        }),
        member({
          id: 'm-parent-new',
          user_id: 'u-parent-new',
          role: 'parent',
          joined_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
    };

    await UserService.deleteUser('u1');

    expect(argsFor('members.update')).toEqual([
      ['m-parent-old', { role: 'owner' }],
    ]);
  });

  it('promotes nobody when the leaver is not the owner', async () => {
    rosters = {
      h1: [member(), member({ id: 'm-parent', user_id: 'u2', role: 'parent' })],
    };

    await UserService.deleteUser('u1');

    expect(argsFor('members.update')).toEqual([]);
  });

  it('promotes nobody when no parent remains, and still deletes the account', async () => {
    // The household is then memberless-or-nannies-only; the reaper and the
    // integrity job are the backstop, not a refusal here.
    memberships = [member({ id: 'm-owner', role: 'owner' })];
    rosters = {
      h1: [
        member({ id: 'm-owner', role: 'owner' }),
        member({ id: 'm-nanny', user_id: 'u2', role: 'nanny' }),
      ],
    };

    await UserService.deleteUser('u1');

    expect(argsFor('members.update')).toEqual([]);
    expect(stepNames()).toContain('auth.delete');
  });

  it('does not promote a removed past member', async () => {
    memberships = [member({ id: 'm-owner', role: 'owner' })];
    rosters = { h1: [member({ id: 'm-owner', role: 'owner' })] };

    await UserService.deleteUser('u1');

    expect(argsFor('members.update')).toEqual([]);
  });
});

describe('UserService.deleteUser — memberless household reaper', () => {
  it('sweeps the captured households after the auth user is gone', async () => {
    memberships = [
      member({ household_id: 'h1' }),
      member({ id: 'm2', household_id: 'h2' }),
    ];

    await UserService.deleteUser('u1');

    expect(argsFor('households.deleteIfMemberless')).toEqual([[['h1', 'h2']]]);
    const names = stepNames();
    expect(names.indexOf('auth.delete')).toBeLessThan(
      names.indexOf('households.deleteIfMemberless')
    );
  });

  it('does not sweep households the user never belonged to', async () => {
    memberships = [];

    await UserService.deleteUser('u1');

    expect(argsFor('households.deleteIfMemberless')).toEqual([[[]]]);
  });
});

describe('UserService.deleteUser — teardown failures never fail the request', () => {
  it('finishes the deletion when end-dating pay throws', async () => {
    failures.pay = true;

    await UserService.deleteUser('u1');

    expect(stepNames()).toContain('auth.delete');
    expect(logger.error).toHaveBeenCalled();
  });

  it('finishes the deletion when the clock-out throws', async () => {
    runningEntry = { id: 'te-1' };
    failures.clockOut = true;

    await UserService.deleteUser('u1');

    // And the later steps still ran — one bad step must not skip the rest.
    expect(stepNames()).toContain('pay.endForCarer');
    expect(stepNames()).toContain('auth.delete');
  });

  it('finishes the deletion even when the membership read itself throws', async () => {
    // Nothing can be torn down without that list — but the account still has
    // to go. The integrity job is the backstop for what got left behind.
    failures.listMemberships = true;

    await UserService.deleteUser('u1');

    expect(stepNames()).toContain('profile.delete');
    expect(stepNames()).toContain('auth.delete');
    expect(logger.error).toHaveBeenCalled();
  });

  it('finishes the deletion when the reaper throws', async () => {
    failures.reap = true;

    await expect(UserService.deleteUser('u1')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
