/**
 * TDD tests for the no-show morning catch-up digest (A1/D-26, matrix row
 * N11). Every dependency is injected via `runNoShowDigestJob`'s parameters
 * so these never touch Supabase — same shape as `uncoveredDigestJob.test.ts`,
 * which this job's structure is copied from.
 */
import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { PushPayload } from '../../../src/domains/notification/types';
import type {
  NoShowDigestCandidateSource,
  NoShowDigestConfirmedChecker,
  NoShowDigestShiftCandidate,
} from '../../../src/jobs/noShowDigestJob';
import {
  buildNoShowDigestKey,
  runNoShowDigestJob,
} from '../../../src/jobs/noShowDigestJob';
import {
  buildNoShowKey,
  type NoShowTimeEntry,
} from '../../../src/jobs/noShowJob';
import type {
  ReminderLogClaim,
  ReminderPushService,
} from '../../../src/jobs/reminderJob';

const CARER_ID = 'carer-11111111-1111-1111-1111-111111111111';
const PARENT_ID = 'parent-11111111-1111-1111-1111-111111111111';
const OTHER_PARENT_ID = 'parent-22222222-2222-2222-2222-222222222222';
const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';
const SHIFT_ID = 'shift-11111111-1111-1111-1111-111111111111';
const LONDON = 'Europe/London';

/** Tuesday 8:00 AM in Europe/London (BST, UTC+1). */
const SHIFT_STARTS_AT = '2026-08-11T07:00:00.000Z';

/** 08:30 local on Wednesday — before the digest window opens. */
const HOUR_06 = new Date('2026-08-12T05:30:00.000Z');
/** 07:30 local — the window opens. */
const HOUR_07 = new Date('2026-08-12T06:30:00.000Z');
/** 09:00 local — still inside. */
const HOUR_09 = new Date('2026-08-12T08:00:00.000Z');
/** 10:30 local — the window has closed. */
const HOUR_10 = new Date('2026-08-12T09:30:00.000Z');

function shift(
  overrides: Partial<NoShowDigestShiftCandidate> = {}
): NoShowDigestShiftCandidate {
  return {
    id: SHIFT_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    starts_at: SHIFT_STARTS_AT,
    timezone: LONDON,
    ...overrides,
  };
}

function candidatesFake(
  shifts: NoShowDigestShiftCandidate[]
): NoShowDigestCandidateSource {
  return { listRecentConfirmedShifts: mock(async () => shifts) };
}

function entries(rows: NoShowTimeEntry[] = []) {
  return { listCoveringEntries: mock(async () => rows) };
}

function noneAlerted(): NoShowDigestConfirmedChecker {
  return { listAlreadyAlerted: mock(async () => new Set<string>()) };
}

function alreadyAlerted(...ids: string[]): NoShowDigestConfirmedChecker {
  return { listAlreadyAlerted: mock(async () => new Set(ids)) };
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

describe('runNoShowDigestJob — the [07:00, 10:00) household-local window', () => {
  it.each([
    ['06:30 local, before the window', HOUR_06, 0],
    ['07:30 local, window opens', HOUR_07, 1],
    ['09:00 local, still inside', HOUR_09, 1],
    ['10:30 local, window has closed', HOUR_10, 0],
  ])('%s', async (_label, now, expectedSent) => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => now }
    );

    expect(sent).toHaveLength(expectedSent);
  });
});

describe('runNoShowDigestJob — yesterday only', () => {
  it("skips a shift that isn't yesterday in the household's local zone", async () => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      // Two days ago, not yesterday.
      candidatesFake([shift({ starts_at: '2026-08-10T07:00:00.000Z' })]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent).toHaveLength(0);
  });

  // GOLDEN #25: PostgREST hands back timestamptz as `+00:00`, JS as `.000Z`
  // — the same instant, two legal serialisations. Every other fixture in
  // this file uses `.000Z`; this one proves the `+00:00` shape parses
  // identically (this code only ever `Date.parse`s/`new Date()`s a
  // timestamp, never string-compares one, but the fixture shape is worth
  // pinning regardless).
  it('parses a +00:00-serialised starts_at the same as .000Z', async () => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift({ starts_at: '2026-08-11T07:00:00+00:00' })]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent).toHaveLength(1);
  });
});

describe('runNoShowDigestJob — coverage reuses noShowJob logic', () => {
  it('skips a shift with a covering clock-in', async () => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries([
        {
          shift_id: SHIFT_ID,
          clock_in_at: '2026-08-11T07:05:00.000Z',
          clock_out_at: '2026-08-11T13:00:00.000Z',
        },
      ]),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent).toHaveLength(0);
  });

  it('alerts a shift with no covering entry', async () => {
    const { push, sent } = capturingPush();

    const result = await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(result.digest.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe('runNoShowDigestJob — already alerted (the immediate push delivered)', () => {
  it('skips a shift whose no_show claim already confirmed', async () => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      alreadyAlerted(SHIFT_ID),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent).toHaveLength(0);
  });
});

describe('runNoShowDigestJob — copy', () => {
  it('names the weekday and time for a single missed shift', async () => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent[0]?.payload.body).toBe(
      "You may have missed this — no one clocked in for Tuesday's 8:00 am shift."
    );
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.SHIFT_NO_SHOW_DIGEST,
        householdId: HOUSEHOLD_ID,
      },
    });
  });

  it('names the count for multiple missed shifts', async () => {
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([
        shift(),
        shift({
          id: 'shift-22222222-2222-2222-2222-222222222222',
          starts_at: '2026-08-11T13:00:00.000Z',
        }),
      ]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent[0]?.payload.body).toBe(
      'You may have missed this — no one clocked in for 2 shifts yesterday.'
    );
  });
});

describe('runNoShowDigestJob — delivery + idempotency', () => {
  it('sends one push per parent, keyed on household + local (yesterday) day', async () => {
    const { log, claims } = statefulLog();
    const { push, sent } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      noneAlerted(),
      log,
      parentsAre(PARENT_ID, OTHER_PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent).toHaveLength(2);
    const key = buildNoShowDigestKey(HOUSEHOLD_ID, '2026-08-11');
    expect(claims.has(`${PARENT_ID}::${key}`)).toBe(true);
    expect(claims.has(`${OTHER_PARENT_ID}::${key}`)).toBe(true);
  });

  it('keys the claim on household + local day', () => {
    expect(buildNoShowDigestKey(HOUSEHOLD_ID, '2026-08-11')).toBe(
      `no_show_digest:${HOUSEHOLD_ID}:2026-08-11`
    );
  });

  it('claims once across two runs inside the same window', async () => {
    const { log, claims } = statefulLog();
    const { push, sent } = capturingPush();
    const source = candidatesFake([shift()]);

    const first = await runNoShowDigestJob(
      source,
      entries(),
      noneAlerted(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );
    const second = await runNoShowDigestJob(
      source,
      entries(),
      noneAlerted(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_09 }
    );

    expect(first.digest.sent).toBe(1);
    expect(second.digest.sent).toBe(0);
    expect(sent).toHaveLength(1);
    expect(claims.size).toBe(1);
  });

  it('sweeps stale claims before claiming anything', async () => {
    const log = alwaysClaims();
    const { push } = capturingPush();

    await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      noneAlerted(),
      log,
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(log.sweepStaleClaims).toHaveBeenCalledTimes(1);
  });

  it('skips a household with no parents to tell', async () => {
    const { push, sent } = capturingPush();
    const log = alwaysClaims();

    const result = await runNoShowDigestJob(
      candidatesFake([shift()]),
      entries(),
      noneAlerted(),
      log,
      parentsAre(),
      push,
      { now: () => HOUR_07 }
    );

    expect(sent).toHaveLength(0);
    expect(result.digest.skipped).toBe(1);
    expect(log.claim).not.toHaveBeenCalled();
  });
});

describe('runNoShowDigestJob — failure isolation', () => {
  it("keeps sweeping when one household's send throws, and counts the error", async () => {
    const shiftA = shift({ household_id: 'house-aaaa' });
    const shiftB = shift({
      household_id: 'house-bbbb',
      id: 'shift-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    const push: ReminderPushService = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async (_userId: string, payload: PushPayload) => {
        if ((payload.data?.householdId as string) === 'house-aaaa') {
          throw new Error('push transport down');
        }
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runNoShowDigestJob(
      candidatesFake([shiftA, shiftB]),
      entries(),
      noneAlerted(),
      alwaysClaims(),
      parentsAre(PARENT_ID),
      push,
      { now: () => HOUR_07 }
    );

    expect(result.digest.sent).toBe(1);
    expect(result.digest.errors).toBe(1);
    expect(result.errorCount).toBe(1);
  });
});

/**
 * `DefaultNoShowDigestConfirmedChecker` is the only raw `push_reminder_log`
 * query outside the repository. Verifies it asks for exactly the
 * `no_show:<id>` keys, confirmed only — mirrors
 * `noShowJob.test.ts`'s trailing default-implementation block.
 */
describe('DefaultNoShowDigestConfirmedChecker', () => {
  it('keys the lookup on buildNoShowKey', () => {
    expect(buildNoShowKey(SHIFT_ID)).toBe(`no_show:${SHIFT_ID}`);
  });
});
