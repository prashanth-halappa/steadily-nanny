/**
 * TDD tests for the no-show sweep. Every dependency is injected via
 * `runNoShowJob`'s parameters so these never touch Supabase — same shape as
 * `reminderJob.test.ts`, which this job's structure is copied from.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import { SHIFT_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { PushPayload } from '../../../src/domains/notification/types';
import type {
  NoShowCandidateSource,
  NoShowShiftCandidate,
  NoShowTimeEntry,
  NoShowTimeEntryLister,
} from '../../../src/jobs/noShowJob';
import { buildNoShowKey, runNoShowJob } from '../../../src/jobs/noShowJob';
import type {
  ReminderLogClaim,
  ReminderPushService,
} from '../../../src/jobs/reminderJob';

const CARER_ID = 'carer-11111111-1111-1111-1111-111111111111';
const PARENT_ID = 'parent-11111111-1111-1111-1111-111111111111';
const OTHER_PARENT_ID = 'parent-22222222-2222-2222-2222-222222222222';
const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';
const SHIFT_ID = 'shift-11111111-1111-1111-1111-111111111111';

/** 08:00 in Europe/London (BST, UTC+1) — the time the copy must render. */
const SHIFT_STARTS_AT = '2026-08-06T07:00:00.000Z';
const startsMs = Date.parse(SHIFT_STARTS_AT);
const minutes = (n: number) => n * 60 * 1000;
const at = (offsetMs: number) => new Date(startsMs + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

function shift(
  overrides: Partial<NoShowShiftCandidate> = {}
): NoShowShiftCandidate {
  return {
    id: SHIFT_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    starts_at: SHIFT_STARTS_AT,
    status: SHIFT_STATUSES.CONFIRMED,
    carer_display_name: 'Sarah',
    timezone: 'Europe/London',
    ...overrides,
  };
}

function candidates(shifts: NoShowShiftCandidate[]): NoShowCandidateSource {
  return { listStartedShifts: mock(async () => shifts) };
}

function entries(rows: NoShowTimeEntry[] = []): NoShowTimeEntryLister {
  return { listCoveringEntries: mock(async () => rows) };
}

/** A log whose `claim` always wins, for tests that don't care about dedupe. */
function alwaysClaims(): ReminderLogClaim {
  return {
    claim: mock(async () => true),
    release: mock(async () => {}),
    confirm: mock(async () => {}),
    sweepStaleClaims: mock(async () => {}),
  };
}

/** In-memory `(user_id, reminder_key)` ledger — a claim wins exactly once. */
function statefulLog(): { log: ReminderLogClaim; claims: Set<string> } {
  const claims = new Set<string>();
  const key = (userId: string, reminderKey: string) =>
    `${userId}::${reminderKey}`;
  return {
    claims,
    log: {
      claim: mock(async (userId: string, reminderKey: string) => {
        const k = key(userId, reminderKey);
        if (claims.has(k)) return false;
        claims.add(k);
        return true;
      }),
      release: mock(async (userId: string, reminderKey: string) => {
        claims.delete(key(userId, reminderKey));
      }),
      confirm: mock(async () => {}),
      sweepStaleClaims: mock(async () => {}),
    },
  };
}

function capturingPush(): {
  push: ReminderPushService;
  sent: Array<{ userId: string; payload: PushPayload }>;
} {
  const sent: Array<{ userId: string; payload: PushPayload }> = [];
  const push: ReminderPushService = {
    canDeliver: mock(async () => true),
    notifyUser: mock(async (userId, payload) => {
      sent.push({ userId, payload });
      return { sent: 1 };
    }),
    notifyHouseholdParents: mock(async () => {}),
  };
  return { push, sent };
}

function parentsAre(...ids: string[]) {
  return { listParentUserIds: mock(async () => ids) };
}

describe('runNoShowJob — the 20-minute window', () => {
  it.each([
    ['19 minutes after the start, still inside the grace period', minutes(19)],
    ['exactly at the start', 0],
    ['2h1m after the start, too stale to be worth a push', minutes(121)],
    ['exactly 2h after the start, the upper bound is exclusive', minutes(120)],
  ])('does not alert %s', async (_label, offset) => {
    const log = alwaysClaims();
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => at(offset) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(log.claim).not.toHaveBeenCalled();
  });

  it.each([
    ['exactly 20 minutes after the start', minutes(20)],
    ['an hour after the start', minutes(60)],
    ['1h59m after the start, the last sweep that still alerts', minutes(119)],
  ])('alerts %s', async (_label, offset) => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(offset) }
    );

    expect(result.noShow.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe('runNoShowJob — she is already on the clock', () => {
  it('skips a carer who clocked in after the shift started', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries([
        { shift_id: null, clock_in_at: iso(minutes(5)), clock_out_at: null },
      ]),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(result.noShow.skipped).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('skips a carer who clocked in early, within the 2h match tolerance', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries([
        { shift_id: null, clock_in_at: iso(-minutes(90)), clock_out_at: null },
      ]),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  // An entry that started BEFORE the match tolerance opens is not one
  // `matchConfirmedShift` would attach to this shift — but if it is still
  // running she is demonstrably at work, and telling the parents nobody
  // turned up would be flatly wrong.
  it('skips a carer still running an entry that began before the tolerance window', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries([
        { shift_id: null, clock_in_at: iso(-minutes(240)), clock_out_at: null },
      ]),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('skips when an entry is explicitly attached to this shift', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries([
        {
          shift_id: SHIFT_ID,
          clock_in_at: iso(-minutes(600)),
          clock_out_at: iso(-minutes(500)),
        },
      ]),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('still alerts when the only entry is an unrelated session that ended before the shift', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries([
        {
          shift_id: 'shift-other',
          clock_in_at: iso(-minutes(600)),
          clock_out_at: iso(-minutes(500)),
        },
      ]),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe('runNoShowJob — shifts that are not candidates', () => {
  it('skips a shift with no carer assigned', async () => {
    const { push, sent } = capturingPush();
    const entryLister = entries();

    const result = await runNoShowJob(
      candidates([shift({ carer_id: null })]),
      entryLister,
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(result.noShow.skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(entryLister.listCoveringEntries).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', SHIFT_STATUSES.CANCELLED],
    ['pending', SHIFT_STATUSES.PENDING],
    ['draft', SHIFT_STATUSES.DRAFT],
  ])('skips a %s shift', async (_label, status) => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift({ status })]),
      entries(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('skips a household with no parents to tell', async () => {
    const { push, sent } = capturingPush();
    const log = alwaysClaims();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries(),
      log,
      parentsAre(),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(log.claim).not.toHaveBeenCalled();
  });
});

describe('runNoShowJob — delivery', () => {
  it('fans out to every parent in the household', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift()]),
      entries(),
      alwaysClaims(),
      parentsAre(PARENT_ID, OTHER_PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(2);
    expect(sent.map(s => s.userId)).toEqual([PARENT_ID, OTHER_PARENT_ID]);
  });

  it('sends the agreed copy and payload', async () => {
    const { push, sent } = capturingPush();

    await runNoShowJob(
      candidates([shift()]),
      entries(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(sent[0]?.payload.title).toBe('No one has clocked in');
    // 07:00Z is 08:00 in the household's own zone — never the server's.
    expect(sent[0]?.payload.body).toBe(
      "Sarah hasn't clocked in for the 08:00 shift at your home."
    );
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW,
        shiftId: SHIFT_ID,
        householdId: HOUSEHOLD_ID,
      },
    });
  });

  it('formats the start time in the household timezone, not UTC', async () => {
    const { push, sent } = capturingPush();

    await runNoShowJob(
      candidates([shift({ timezone: 'America/Los_Angeles' })]),
      entries(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    // 07:00Z on 2026-08-06 is 00:00 PDT.
    expect(sent[0]?.payload.body).toContain('00:00 shift');
  });

  it('does not claim a push that prefs or quiet hours would suppress', async () => {
    const log = alwaysClaims();
    const push: ReminderPushService = {
      canDeliver: mock(async () => false),
      notifyUser: mock(async () => {
        throw new Error('must not be called when canDeliver is false');
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runNoShowJob(
      candidates([shift()]),
      entries(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(log.claim).not.toHaveBeenCalled();
    expect(push.notifyUser).not.toHaveBeenCalled();
    expect(result.noShow.sent).toBe(0);
    expect(result.noShow.errors).toBe(0);
  });
});

describe('runNoShowJob — idempotency', () => {
  it('sends nothing on a second sweep of the same shift', async () => {
    const { log, claims } = statefulLog();
    const { push, sent } = capturingPush();
    const source = candidates([shift()]);
    const entryLister = entries();
    const parents = parentsAre(PARENT_ID, OTHER_PARENT_ID);

    const first = await runNoShowJob(source, entryLister, log, parents, push, {
      now: () => at(minutes(25)),
    });
    // Ten minutes later, the next pg_cron tick — same shift, still no entry.
    const second = await runNoShowJob(source, entryLister, log, parents, push, {
      now: () => at(minutes(35)),
    });

    expect(first.noShow.sent).toBe(2);
    expect(second.noShow.sent).toBe(0);
    expect(second.noShow.skipped).toBe(2);
    expect(sent).toHaveLength(2);
    // One row per parent, keyed on the shift with no date segment, so every
    // later tick inside the window collides with the send that happened.
    expect(claims.size).toBe(2);
  });

  it('keys the claim on the shift id', () => {
    expect(buildNoShowKey(SHIFT_ID)).toBe(`no_show:${SHIFT_ID}`);
  });

  it('sweeps stale claims before claiming anything', async () => {
    const log = alwaysClaims();
    const { push } = capturingPush();

    await runNoShowJob(
      candidates([shift()]),
      entries(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(log.sweepStaleClaims).toHaveBeenCalledTimes(1);
  });
});

describe('runNoShowJob — failure isolation', () => {
  it('keeps sweeping when one shift throws, and counts the error', async () => {
    const shiftA = shift({ id: 'shift-aaaa', household_id: 'house-aaaa' });
    const shiftB = shift({ id: 'shift-bbbb', household_id: 'house-bbbb' });
    const { log, claims } = statefulLog();
    const push: ReminderPushService = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async (_userId, payload) => {
        if ((payload.data?.shiftId as string) === 'shift-aaaa') {
          throw new Error('push transport down');
        }
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runNoShowJob(
      candidates([shiftA, shiftB]),
      entries(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(1);
    expect(result.noShow.errors).toBe(1);
    expect(result.errorCount).toBe(1);
    // The failed shift's claim is released so the next tick retries it.
    expect(claims.has(`${PARENT_ID}::no_show:shift-aaaa`)).toBe(false);
    expect(claims.has(`${PARENT_ID}::no_show:shift-bbbb`)).toBe(true);
  });

  it('falls back to UTC rather than throwing on a broken household timezone', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowJob(
      candidates([shift({ timezone: 'Not/A_Real_Zone' })]),
      entries(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.errorCount).toBe(0);
    expect(sent[0]?.payload.body).toContain('07:00 shift');
  });
});

/**
 * DefaultNoShowTimeEntryLister is the only raw `time_entries` query outside
 * the repository. These tests mock Supabase and exercise the default lister
 * via `runNoShowJob` (entries param omitted).
 */
describe('DefaultNoShowTimeEntryLister — voided entries are not coverage (069)', () => {
  let runNoShowJobWithDefaults: typeof runNoShowJob;
  // `any` matches the house style for a mocked supabase client (see
  // scheduleShiftRepository.test.ts:16) — the mocked shape and the real
  // SupabaseClient type do not line up, and tests get a relaxed no-any rule.
  // biome-ignore lint/suspicious/noExplicitAny: mocked supabase client
  let mockSupabaseService: any;

  function createSupabaseQueryChain(finalResponse: {
    data: unknown;
    error: unknown;
  }): any {
    const chain: any = {
      select: mock(() => chain),
      eq: mock(() => chain),
      neq: mock(() => chain),
      or: mock(() => chain),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(finalResponse).then(resolve),
    };
    return chain;
  }

  beforeAll(async () => {
    mock.module('../../../src/config/supabase', () => {
      const obj = {
        from: mock(() => createSupabaseQueryChain({ data: [], error: null })),
      };
      return { supabase: obj, supabaseService: obj };
    });

    const mod = await import('../../../src/jobs/noShowJob');
    runNoShowJobWithDefaults = mod.runNoShowJob;
    mockSupabaseService = (await import('../../../src/config/supabase'))
      .supabaseService;
  });

  it('alerts when the only covering entry is voided — voided did not happen', async () => {
    mockSupabaseService.from.mockImplementation(() =>
      createSupabaseQueryChain({
        data: [
          {
            shift_id: SHIFT_ID,
            clock_in_at: iso(minutes(5)),
            clock_out_at: iso(minutes(65)),
            status: 'voided',
          },
        ],
        error: null,
      })
    );
    const { push, sent } = capturingPush();

    const result = await runNoShowJobWithDefaults(
      candidates([shift()]),
      undefined,
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(result.noShow.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('excludes voided rows in the Supabase query', async () => {
    const chain = createSupabaseQueryChain({ data: [], error: null });
    mockSupabaseService.from.mockImplementation(() => chain);
    const { push } = capturingPush();

    await runNoShowJobWithDefaults(
      candidates([shift()]),
      undefined,
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => at(minutes(25)) }
    );

    expect(chain.neq).toHaveBeenCalledWith('status', 'voided');
  });
});
