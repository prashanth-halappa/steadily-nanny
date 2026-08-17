/**
 * TDD tests for the reminders-hourly job. Every dependency is injected via
 * `runReminderJob`'s parameters so these never touch Supabase.
 */
import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  SHIFT_KINDS,
  SHIFT_STATUSES,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import type {
  ReminderCandidateSource,
  ReminderLogClaim,
  ReminderPushService,
  ShiftReminderCandidate,
  TimesheetReminderCandidate,
} from '../../../src/jobs/reminderJob';
import { runReminderJob } from '../../../src/jobs/reminderJob';

const CARER_ID = 'carer-11111111-1111-1111-1111-111111111111';
const PARENT_ID = 'parent-11111111-1111-1111-1111-111111111111';
const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';
const SHIFT_ID = 'shift-11111111-1111-1111-1111-111111111111';
const TIMESHEET_ID = 'sheet-11111111-1111-1111-1111-111111111111';

/** 2026-08-05 18:00 in America/Los_Angeles (PDT, UTC-7). */
const LA_18_00 = new Date('2026-08-06T01:00:00.000Z');

/** Same local day, later in the send window (F-B6-2). */
const LA_19_00 = new Date('2026-08-06T02:00:00.000Z');
const LA_20_00 = new Date('2026-08-06T03:00:00.000Z');
/** One hour past the window end — too late to be worth waking someone. */
const LA_22_00 = new Date('2026-08-06T05:00:00.000Z');
/** Before the window opens. */
const LA_17_00 = new Date('2026-08-06T00:00:00.000Z');

/**
 * The SAME instant is 11:00 the next morning in Australia/Sydney (AEST,
 * UTC+10) — the point being that the gate reads the recipient's wall clock,
 * not the server's. This used to name America/New_York and claim 11:00, but
 * that instant is 21:00 in New York; the label was wrong and the assertion
 * only held because the gate was an equality on 18:00. Under the F-B6-2
 * window 21:00 legitimately sends, which is what exposed it.
 */
const SYDNEY_11_00_SAME_INSTANT = LA_18_00;

function emptyCandidates(): ReminderCandidateSource {
  return {
    listShiftReminders: mock(async () => []),
    listTimesheetAwaitingApproval: mock(async () => []),
    // Covered in `reminderJob.scheduleNotSet*.test.ts`; empty here so the
    // shift/timesheet assertions below stay about one rule at a time.
    listScheduleNotSet: mock(async () => []),
  };
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

/**
 * A log backed by an in-memory set, so `claim`/`release` behave like the
 * real `(user_id, reminder_key)` ledger — a claim wins once, a release frees
 * it for a later run to claim again. Used to prove the fix end to end rather
 * than just asserting the right mock was called.
 */
function statefulLog(): {
  log: ReminderLogClaim;
  claims: Set<string>;
  /** Unconfirmed claims are the ones a crashed run leaves behind (C3). */
  confirmed: Set<string>;
  /** Operation names in the order the job called them. */
  order: string[];
} {
  const claims = new Set<string>();
  const confirmed = new Set<string>();
  const order: string[] = [];
  const key = (userId: string, reminderKey: string) =>
    `${userId}::${reminderKey}`;
  return {
    claims,
    confirmed,
    order,
    log: {
      claim: mock(async (userId: string, reminderKey: string) => {
        order.push('claim');
        const k = key(userId, reminderKey);
        if (claims.has(k)) return false;
        claims.add(k);
        return true;
      }),
      release: mock(async (userId: string, reminderKey: string) => {
        order.push('release');
        claims.delete(key(userId, reminderKey));
      }),
      confirm: mock(async (userId: string, reminderKey: string) => {
        order.push('confirm');
        confirmed.add(key(userId, reminderKey));
      }),
      sweepStaleClaims: mock(async () => {
        order.push('sweep');
      }),
    },
  };
}

/** `canDeliver` always true, `notifyUser` always reports one device reached. */
function capturingPush(): {
  push: ReminderPushService;
  sent: Array<{ userId: string; payload: unknown }>;
} {
  const sent: Array<{ userId: string; payload: unknown }> = [];
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

function shiftStartingTomorrowLa(
  overrides: Partial<ShiftReminderCandidate> = {}
): ShiftReminderCandidate {
  return {
    id: SHIFT_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    // Tomorrow in LA when now is 2026-08-05 local.
    starts_at: '2026-08-06T15:00:00.000Z',
    kind: SHIFT_KINDS.RECURRING,
    status: SHIFT_STATUSES.CONFIRMED,
    ...overrides,
  };
}

function pendingCoverAskTomorrowLa(): ShiftReminderCandidate {
  return shiftStartingTomorrowLa({
    kind: SHIFT_KINDS.COVER,
    status: SHIFT_STATUSES.PENDING,
  });
}

describe('runReminderJob', () => {
  it('gates on the recipient’s local hour: 18:00 sends, 11:00 elsewhere does not', async () => {
    const shift = shiftStartingTomorrowLa();
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shift]),
    };
    const log: ReminderLogClaim = alwaysClaims();
    const { push, sent } = capturingPush();

    const at18 = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(at18.shiftReminder.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER,
        shiftId: SHIFT_ID,
        householdId: HOUSEHOLD_ID,
      },
    });

    const { push: push11, sent: sent11 } = capturingPush();
    const at11 = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'Australia/Sydney') },
      { listParentUserIds: mock(async () => []) },
      push11,
      { now: () => SYDNEY_11_00_SAME_INSTANT }
    );

    expect(at11.shiftReminder.sent).toBe(0);
    expect(sent11).toHaveLength(0);
  });

  // F-B6-2. The hour gate was an equality on 18:00 local, so a single missed
  // or late hourly run — a deploy, a pg_cron hiccup, an outage — dropped that
  // evening's shift reminders entirely and nothing ever retried them. The gate
  // is a window now; the ledger key (`shift_reminder:<id>`, no date segment)
  // is what keeps a wider window from re-sending.
  it.each([
    ['18:00, the window opens', LA_18_00],
    ['19:00, mid-window', LA_19_00],
    ['20:00, late in the window', LA_20_00],
  ])('sends a shift reminder at %s', async (_label, instant) => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
    };
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      alwaysClaims(),
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => instant }
    );

    expect(result.shiftReminder.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['17:00, before the window opens', LA_17_00],
    ['22:00, after the window closes', LA_22_00],
  ])('does not send a shift reminder at %s', async (_label, instant) => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
    };
    const log = alwaysClaims();
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => instant }
    );

    expect(result.shiftReminder.sent).toBe(0);
    expect(sent).toHaveLength(0);
    expect(log.claim).not.toHaveBeenCalled();
  });

  it('does not double-send across the widened window — the claim is dateless', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
    };
    const { log, claims } = statefulLog();
    const timezone = { resolve: mock(async () => 'America/Los_Angeles') };
    const parents = { listParentUserIds: mock(async () => []) };
    const { push, sent } = capturingPush();

    const first = await runReminderJob(
      candidates,
      log,
      timezone,
      parents,
      push,
      {
        now: () => LA_18_00,
      }
    );
    const second = await runReminderJob(
      candidates,
      log,
      timezone,
      parents,
      push,
      { now: () => LA_19_00 }
    );

    expect(first.shiftReminder.sent).toBe(1);
    expect(second.shiftReminder.sent).toBe(0);
    expect(second.shiftReminder.skipped).toBe(1);
    expect(sent).toHaveLength(1);
    // One claim row, still held — the key has no date segment, so every hour
    // of the window collides with the send that already happened.
    expect(claims.size).toBe(1);
  });

  it('dedupes: a second run skips when claim returns false', async () => {
    const shift = shiftStartingTomorrowLa();
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shift]),
    };
    let claimCalls = 0;
    const log: ReminderLogClaim = {
      claim: mock(async () => {
        claimCalls++;
        return claimCalls === 1;
      }),
      release: mock(async () => {}),
      confirm: mock(async () => {}),
      sweepStaleClaims: mock(async () => {}),
    };
    const { push, sent } = capturingPush();
    const timezone = { resolve: mock(async () => 'America/Los_Angeles') };
    const parents = { listParentUserIds: mock(async () => []) };
    const clock = { now: () => LA_18_00 };

    await runReminderJob(candidates, log, timezone, parents, push, clock);
    await runReminderJob(candidates, log, timezone, parents, push, clock);

    expect(sent).toHaveLength(1);
    expect(claimCalls).toBe(2);
  });

  it('falls back to UTC for an invalid timezone without throwing', async () => {
    const shift = shiftStartingTomorrowLa();
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shift]),
    };
    const log: ReminderLogClaim = alwaysClaims();
    const { push } = capturingPush();

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'Not/A_Real_Zone') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(result.errorCount).toBe(0);
  });

  it('sends timesheet_awaiting_approval with the required payload keys', async () => {
    const timesheet: TimesheetReminderCandidate = {
      id: TIMESHEET_ID,
      household_id: HOUSEHOLD_ID,
      week_start: '2026-08-04',
      // Exactly 3 days before `londonNine` below — day 3 is the nag-cap's
      // entry threshold (D-27, §1.5) and always sends, so this fixture stays
      // valid regardless of the cap. Cadence itself is covered separately.
      updated_at: '2026-08-02T08:00:00.000Z',
    };
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listTimesheetAwaitingApproval: mock(async () => [timesheet]),
    };
    const log: ReminderLogClaim = alwaysClaims();
    const { push, sent } = capturingPush();

    /** 2026-08-05 09:00 in Europe/London (BST). */
    const londonNine = new Date('2026-08-05T08:00:00.000Z');

    await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'Europe/London') },
      { listParentUserIds: mock(async () => [PARENT_ID]) },
      push,
      { now: () => londonNine }
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.TIMESHEET_AWAITING_APPROVAL,
        timesheetId: TIMESHEET_ID,
        householdId: HOUSEHOLD_ID,
        weekStart: '2026-08-04',
      },
    });
  });

  it('keeps processing when one recipient throws and increments errorCount', async () => {
    const shiftA = {
      ...shiftStartingTomorrowLa(),
      id: 'shift-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      carer_id: 'carer-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    };
    const shiftB = {
      ...shiftStartingTomorrowLa(),
      id: 'shift-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      carer_id: 'carer-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    };
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftA, shiftB]),
    };
    const log: ReminderLogClaim = alwaysClaims();
    const timezone = { resolve: mock(async () => 'America/Los_Angeles') };
    const parents = { listParentUserIds: mock(async () => []) };
    const push: ReminderPushService = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async (userId: string) => {
        if (userId === shiftA.carer_id) {
          throw new Error('push transport down');
        }
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runReminderJob(
      candidates,
      log,
      timezone,
      parents,
      push,
      { now: () => LA_18_00 }
    );

    expect(result.shiftReminder.sent).toBe(1);
    expect(result.shiftReminder.errors).toBe(1);
    expect(result.errorCount).toBe(1);

    // The throwing carer's claim is released so a later run retries it; the
    // other carer's claim is untouched — one user's failure can't suppress
    // another user's reminder.
    expect(log.release).toHaveBeenCalledWith(
      shiftA.carer_id,
      expect.stringContaining(shiftA.id)
    );
    expect(log.release).toHaveBeenCalledTimes(1);
  });

  it('does not claim a reminder that would be suppressed (quiet hours / opt-out / no devices)', async () => {
    const shift = shiftStartingTomorrowLa();
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shift]),
    };
    const log = alwaysClaims();
    const push: ReminderPushService = {
      canDeliver: mock(async () => false),
      notifyUser: mock(async () => {
        throw new Error('must not be called when canDeliver is false');
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(log.claim).not.toHaveBeenCalled();
    expect(push.notifyUser).not.toHaveBeenCalled();
    expect(result.shiftReminder.sent).toBe(0);
    expect(result.shiftReminder.errors).toBe(0);
  });

  it('releases the claim when the send reaches zero devices, so a later run retries', async () => {
    const shift = shiftStartingTomorrowLa();
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shift]),
    };
    const { log, claims } = statefulLog();
    const timezone = { resolve: mock(async () => 'America/Los_Angeles') };
    const parents = { listParentUserIds: mock(async () => []) };
    const clock = { now: () => LA_18_00 };

    // First run: passes the pre-check but Expo delivers to nobody (e.g.
    // every token went invalid between the check and the send).
    const failingPush: ReminderPushService = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async () => ({ sent: 0 })),
      notifyHouseholdParents: mock(async () => {}),
    };
    const firstRun = await runReminderJob(
      candidates,
      log,
      timezone,
      parents,
      failingPush,
      clock
    );

    expect(firstRun.shiftReminder.sent).toBe(0);
    expect(firstRun.shiftReminder.errors).toBe(0);
    expect(log.release).toHaveBeenCalledWith(
      CARER_ID,
      expect.stringContaining(SHIFT_ID)
    );
    // The claim was released, not left dangling — the ledger has no row for
    // this reminder, so a second run is free to claim it again.
    expect(claims.size).toBe(0);

    // Second run: the token issue is gone, the send succeeds.
    const { push: workingPush, sent } = capturingPush();
    const secondRun = await runReminderJob(
      candidates,
      log,
      timezone,
      parents,
      workingPush,
      clock
    );

    expect(secondRun.shiftReminder.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  // C3 — the crash window 047's header called unrecoverable. A process killed
  // between the claim commit and the send returning leaves a claim standing
  // for a reminder nobody got, and the claim IS the dedupe key, so it is
  // suppressed forever. Confirm-after-send plus a sweep of unconfirmed claims
  // is the two-phase ledger that closes it.
  it('confirms the claim after a send that actually reached a device', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
    };
    const { log, claims, confirmed, order } = statefulLog();
    const { push } = capturingPush();

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(result.shiftReminder.sent).toBe(1);
    expect(claims.size).toBe(1);
    expect(confirmed.size).toBe(1);
    // Confirm comes AFTER the claim, never instead of it — a confirm-first
    // ledger would not dedupe overlapping runs at all.
    expect(order).toEqual(['sweep', 'claim', 'confirm']);
  });

  it('sweeps stale claims once, before anything is claimed', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
    };
    const { log, order } = statefulLog();
    const { push } = capturingPush();

    await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(log.sweepStaleClaims).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('sweep');
  });

  it('does not send a delivered reminder into the release path when confirm fails', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
    };
    const log: ReminderLogClaim = {
      ...alwaysClaims(),
      confirm: mock(async () => {
        throw new Error('confirm write failed');
      }),
    };
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    // The push DID go out. Releasing the claim here would guarantee a
    // duplicate on the next run to fix a bookkeeping failure that costs at
    // most one duplicate after the sweep horizon.
    expect(sent).toHaveLength(1);
    expect(result.shiftReminder.sent).toBe(1);
    expect(result.shiftReminder.errors).toBe(0);
    expect(log.release).not.toHaveBeenCalled();
  });

  it('releases the claim and records an error when the send throws', async () => {
    const shift = shiftStartingTomorrowLa();
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [shift]),
    };
    const { log, claims } = statefulLog();
    const push: ReminderPushService = {
      canDeliver: mock(async () => true),
      notifyUser: mock(async () => {
        throw new Error('Expo request failed');
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(result.shiftReminder.sent).toBe(0);
    expect(result.shiftReminder.errors).toBe(1);
    expect(claims.size).toBe(0);
  });
});

// A2 / matrix row N7: the evening shift-reminder job now also covers a
// PENDING cover-ask (kind='cover', status='pending') — today it only
// reminded about confirmed shifts, so a pending ask got no reminder ever.
describe('runReminderJob — cover-ask reminder (A2, N7)', () => {
  it('sends cover_ask_reminder, not shift_reminder, for a pending cover-ask starting tomorrow', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [pendingCoverAskTomorrowLa()]),
    };
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      alwaysClaims(),
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(result.shiftReminder.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.COVER_ASK_REMINDER,
        shiftId: SHIFT_ID,
        householdId: HOUSEHOLD_ID,
      },
    });
  });

  it('keys the cover-ask reminder claim separately from shift_reminder — muting one never mutes the other', async () => {
    const { log, claims } = statefulLog();
    const { push } = capturingPush();
    const timezone = { resolve: mock(async () => 'America/Los_Angeles') };
    const parents = { listParentUserIds: mock(async () => []) };
    const clock = { now: () => LA_18_00 };

    await runReminderJob(
      {
        ...emptyCandidates(),
        listShiftReminders: mock(async () => [shiftStartingTomorrowLa()]),
      },
      log,
      timezone,
      parents,
      push,
      clock
    );
    await runReminderJob(
      {
        ...emptyCandidates(),
        listShiftReminders: mock(async () => [pendingCoverAskTomorrowLa()]),
      },
      log,
      timezone,
      parents,
      push,
      clock
    );

    expect(claims.has(`${CARER_ID}::shift_reminder:${SHIFT_ID}`)).toBe(true);
    expect(claims.has(`${CARER_ID}::cover_ask_reminder:${SHIFT_ID}`)).toBe(
      true
    );
  });

  it('respects the same [18:00, 22:00) local window as shift_reminder', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [pendingCoverAskTomorrowLa()]),
    };
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      alwaysClaims(),
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_17_00 }
    );

    expect(result.shiftReminder.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('does not claim a cover-ask reminder that would be suppressed (quiet hours / opt-out)', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [pendingCoverAskTomorrowLa()]),
    };
    const log = alwaysClaims();
    const push: ReminderPushService = {
      canDeliver: mock(async () => false),
      notifyUser: mock(async () => {
        throw new Error('must not be called when canDeliver is false');
      }),
      notifyHouseholdParents: mock(async () => {}),
    };

    const result = await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(log.claim).not.toHaveBeenCalled();
    expect(result.shiftReminder.sent).toBe(0);
  });

  it('still sends the ordinary shift_reminder for a CONFIRMED cover-kind shift', async () => {
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listShiftReminders: mock(async () => [
        shiftStartingTomorrowLa({
          kind: SHIFT_KINDS.COVER,
          status: SHIFT_STATUSES.CONFIRMED,
        }),
      ]),
    };
    const { push, sent } = capturingPush();

    await runReminderJob(
      candidates,
      alwaysClaims(),
      { resolve: mock(async () => 'America/Los_Angeles') },
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_18_00 }
    );

    expect(sent[0]?.payload).toMatchObject({
      data: { type: PUSH_NOTIFICATION_TYPES.SHIFT_REMINDER },
    });
  });
});

// A7 / D-27: cap the timesheet_awaiting_approval nudge at 3 consecutive
// daily nudges, then weekly — implemented as
// `daysSinceSubmitted <= 3 || daysSinceSubmitted % 7 === 0`, no counter
// table, per §1.5 of the design spec.
describe('runReminderJob — timesheet nag cap (A7, D-27)', () => {
  const LONDON_NINE = new Date('2026-08-05T08:00:00.000Z');
  const dayMs = 24 * 60 * 60 * 1000;

  function timesheetSubmittedDaysAgo(days: number): TimesheetReminderCandidate {
    return {
      id: TIMESHEET_ID,
      household_id: HOUSEHOLD_ID,
      week_start: '2026-08-04',
      updated_at: new Date(LONDON_NINE.getTime() - days * dayMs).toISOString(),
    };
  }

  it.each([
    ['day 3, the entry threshold', 3, 1],
    ['day 4, past the entry threshold', 4, 0],
    ['day 5', 5, 0],
    ['day 6', 6, 0],
    ['day 7, the first weekly beat', 7, 1],
    ['day 8, back to silent', 8, 0],
    ['day 13', 13, 0],
    ['day 14, the second weekly beat', 14, 1],
  ])('%s', async (_label, days, expectedSent) => {
    const timesheet = timesheetSubmittedDaysAgo(days);
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listTimesheetAwaitingApproval: mock(async () => [timesheet]),
    };
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      alwaysClaims(),
      { resolve: mock(async () => 'Europe/London') },
      { listParentUserIds: mock(async () => [PARENT_ID]) },
      push,
      { now: () => LONDON_NINE }
    );

    expect(result.timesheetAwaitingApproval.sent).toBe(expectedSent);
    expect(sent).toHaveLength(expectedSent);
  });

  it('does not claim a nudge the cap silences', async () => {
    const timesheet = timesheetSubmittedDaysAgo(5);
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listTimesheetAwaitingApproval: mock(async () => [timesheet]),
    };
    const log = alwaysClaims();
    const { push } = capturingPush();

    await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'Europe/London') },
      { listParentUserIds: mock(async () => [PARENT_ID]) },
      push,
      { now: () => LONDON_NINE }
    );

    expect(log.claim).not.toHaveBeenCalled();
  });

  // GOLDEN #25: `daysSinceSubmitted` is computed via `Date.parse`, never a
  // string compare, so a `+00:00`-serialised `updated_at` (PostgREST's
  // shape) must gate identically to the `.000Z` fixtures above.
  it('gates identically on a +00:00-serialised updated_at', async () => {
    const timesheet: TimesheetReminderCandidate = {
      id: TIMESHEET_ID,
      household_id: HOUSEHOLD_ID,
      week_start: '2026-08-04',
      updated_at: '2026-08-02T08:00:00+00:00', // day 3 — sends.
    };
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listTimesheetAwaitingApproval: mock(async () => [timesheet]),
    };
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidates,
      alwaysClaims(),
      { resolve: mock(async () => 'Europe/London') },
      { listParentUserIds: mock(async () => [PARENT_ID]) },
      push,
      { now: () => LONDON_NINE }
    );

    expect(result.timesheetAwaitingApproval.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
