/**
 * TDD tests for the reminders-hourly job. Every dependency is injected via
 * `runReminderJob`'s parameters so these never touch Supabase.
 */
import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  ApprovalExpiringCandidate,
  ReminderCandidateSource,
  ReminderLogClaim,
  ReminderPushService,
  ShiftReminderCandidate,
  TimesheetReminderCandidate,
} from '../../../src/jobs/reminderJob';
import { runReminderJob } from '../../../src/jobs/reminderJob';

const CARER_ID = 'carer-11111111-1111-1111-1111-111111111111';
const PARENT_ID = 'parent-11111111-1111-1111-1111-111111111111';
const OTHER_PARENT_ID = 'parent-22222222-2222-2222-2222-222222222222';
const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';
const SHIFT_ID = 'shift-11111111-1111-1111-1111-111111111111';
const TIMESHEET_ID = 'sheet-11111111-1111-1111-1111-111111111111';
const APPROVAL_ID = 'appr-11111111-1111-1111-1111-111111111111';

/** 2026-08-05 18:00 in America/Los_Angeles (PDT, UTC-7). */
const LA_18_00 = new Date('2026-08-06T01:00:00.000Z');

/** Same instant is 11:00 in America/New_York (EDT, UTC-4). */
const NY_11_00_SAME_INSTANT = LA_18_00;

function emptyCandidates(): ReminderCandidateSource {
  return {
    listShiftReminders: mock(async () => []),
    listTimesheetAwaitingApproval: mock(async () => []),
    listApprovalExpiring: mock(async () => []),
  };
}

/** A log whose `claim` always wins, for tests that don't care about dedupe. */
function alwaysClaims(): ReminderLogClaim {
  return {
    claim: mock(async () => true),
    release: mock(async () => {}),
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
} {
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

function shiftStartingTomorrowLa(): ShiftReminderCandidate {
  return {
    id: SHIFT_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    // Tomorrow in LA when now is 2026-08-05 local.
    starts_at: '2026-08-06T15:00:00.000Z',
  };
}

describe('runReminderJob', () => {
  it('sends a shift reminder at 18:00 local and skips at 11:00 local for the same instant', async () => {
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
      { resolve: mock(async () => 'America/New_York') },
      { listParentUserIds: mock(async () => []) },
      push11,
      { now: () => NY_11_00_SAME_INSTANT }
    );

    expect(at11.shiftReminder.sent).toBe(0);
    expect(sent11).toHaveLength(0);
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
      updated_at: '2026-08-01T00:00:00.000Z',
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

  it('sends approval_expiring with householdId and no local-hour gate', async () => {
    const approval: ApprovalExpiringCandidate = {
      id: APPROVAL_ID,
      household_id: HOUSEHOLD_ID,
      requested_by: PARENT_ID,
      timeout_at: '2026-08-05T12:00:00.000Z',
    };
    const candidates: ReminderCandidateSource = {
      ...emptyCandidates(),
      listApprovalExpiring: mock(async () => [approval]),
    };
    const log: ReminderLogClaim = alwaysClaims();
    const { push, sent } = capturingPush();

    /** 03:00 local would block hour-gated rules — must not block this one. */
    const oddHour = new Date('2026-08-05T10:00:00.000Z');

    await runReminderJob(
      candidates,
      log,
      { resolve: mock(async () => 'America/Los_Angeles') },
      {
        listParentUserIds: mock(async () => [PARENT_ID, OTHER_PARENT_ID]),
      },
      push,
      { now: () => oddHour }
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.userId).toBe(OTHER_PARENT_ID);
    expect(sent[0]?.payload).toMatchObject({
      data: {
        type: PUSH_NOTIFICATION_TYPES.APPROVAL_EXPIRING,
        householdId: HOUSEHOLD_ID,
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
