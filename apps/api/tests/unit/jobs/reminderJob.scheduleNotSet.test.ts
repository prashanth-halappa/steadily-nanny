/**
 * `schedule_not_set` — the push that closes the gap after terms are agreed.
 *
 * `termsProposalCommandService.accept()` is a money-only transition: it
 * activates the membership, inserts the `pay_arrangements` row, and creates no
 * schedule. Nothing has ever told the parent that the nanny still does not
 * know when she is working, and the builder is hard to find on its own.
 *
 * Every dependency is injected through `runReminderJob`'s parameters, so
 * nothing here touches Supabase. The candidate-set conditions that live in
 * SQL (live household, active nanny, arrangement exists and is a day old, no
 * pattern ever) are covered in `reminderJob.scheduleNotSetSource.test.ts`.
 */
import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  ReminderCandidateSource,
  ReminderLogClaim,
  ReminderPushService,
  ScheduleNotSetCandidate,
} from '../../../src/jobs/reminderJob';
import {
  buildScheduleNotSetKey,
  runReminderJob,
} from '../../../src/jobs/reminderJob';

const CARER_ID = 'carer-11111111-1111-1111-1111-111111111111';
const PARENT_ID = 'parent-11111111-1111-1111-1111-111111111111';
const SECOND_PARENT_ID = 'parent-22222222-2222-2222-2222-222222222222';
const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';

/** 2026-08-05 09:00 in America/Los_Angeles (PDT, UTC-7). */
const LA_09_00 = new Date('2026-08-05T16:00:00.000Z');
/** One hour early, and one hour late — the gate is an equality. */
const LA_08_00 = new Date('2026-08-05T15:00:00.000Z');
const LA_10_00 = new Date('2026-08-05T17:00:00.000Z');

function candidateSource(
  rows: ScheduleNotSetCandidate[]
): ReminderCandidateSource {
  return {
    listShiftReminders: mock(async () => []),
    listTimesheetAwaitingApproval: mock(async () => []),
    listScheduleNotSet: mock(async () => rows),
  };
}

function scheduleNotSet(
  overrides: Partial<ScheduleNotSetCandidate> = {}
): ScheduleNotSetCandidate {
  return {
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Marisol',
    ...overrides,
  };
}

/**
 * A log backed by an in-memory set, so a second run behaves like the real
 * `(user_id, reminder_key)` ledger rather than a mock that always says yes.
 */
function statefulLog(): ReminderLogClaim {
  const claims = new Set<string>();
  return {
    claim: mock(async (userId: string, reminderKey: string) => {
      const k = `${userId}::${reminderKey}`;
      if (claims.has(k)) return false;
      claims.add(k);
      return true;
    }),
    release: mock(async (userId: string, reminderKey: string) => {
      claims.delete(`${userId}::${reminderKey}`);
    }),
    confirm: mock(async () => {}),
    sweepStaleClaims: mock(async () => {}),
  };
}

function capturingPush(deliverable = true): {
  push: ReminderPushService;
  sent: Array<{ userId: string; payload: unknown }>;
} {
  const sent: Array<{ userId: string; payload: unknown }> = [];
  return {
    sent,
    push: {
      canDeliver: mock(async () => deliverable),
      notifyUser: mock(async (userId, payload) => {
        sent.push({ userId, payload });
        return { sent: 1 };
      }),
      notifyHouseholdParents: mock(async () => {}),
    },
  };
}

const la = { resolve: mock(async () => 'America/Los_Angeles') };
const oneParent = { listParentUserIds: mock(async () => [PARENT_ID]) };

describe('runReminderJob — schedule_not_set', () => {
  it('sends at local 09:00, naming the carer and pointing at the builder', async () => {
    const log = statefulLog();
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidateSource([scheduleNotSet()]),
      log,
      la,
      oneParent,
      push,
      { now: () => LA_09_00 }
    );

    expect(result.scheduleNotSet.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.userId).toBe(PARENT_ID);
    expect(sent[0]?.payload).toMatchObject({
      title: "Marisol doesn't know when she's working yet",
      body: 'Send her the days and times you need each week.',
      data: {
        type: PUSH_NOTIFICATION_TYPES.SCHEDULE_NOT_SET,
        householdId: HOUSEHOLD_ID,
        carerId: CARER_ID,
      },
    });
    // House rule (`termsProposalCommandService`): never a figure in a body —
    // a lock screen is a public surface.
    const shown = sent[0]?.payload as { title: string; body: string };
    expect(`${shown.title} ${shown.body}`).not.toMatch(/\d/);
  });

  // The name resolves at candidate time; when nothing does, the sentence must
  // still be about HER, not about "Someone" — same shape as the `Carer`
  // fallback the pay domain uses, minus the placeholder word.
  it('names nobody rather than a placeholder when no display name resolved', async () => {
    const { push, sent } = capturingPush();

    await runReminderJob(
      candidateSource([scheduleNotSet({ carer_display_name: null })]),
      statefulLog(),
      la,
      oneParent,
      push,
      { now: () => LA_09_00 }
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toMatchObject({
      title: "Your nanny doesn't know when she's working yet",
    });
  });

  it.each([
    ['08:00, an hour early', LA_08_00],
    ['10:00, an hour late', LA_10_00],
  ])('does not send at %s local', async (_label, now) => {
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidateSource([scheduleNotSet()]),
      statefulLog(),
      la,
      oneParent,
      push,
      { now: () => now }
    );

    expect(result.scheduleNotSet.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  // The gate reads the RECIPIENT's wall clock. The same instant that is 09:00
  // in Los Angeles is 02:00 the next day in Sydney.
  it('gates on the parent’s own timezone, not the server’s', async () => {
    const { push, sent } = capturingPush();

    await runReminderJob(
      candidateSource([scheduleNotSet()]),
      statefulLog(),
      { resolve: mock(async () => 'Australia/Sydney') },
      oneParent,
      push,
      { now: () => LA_09_00 }
    );

    expect(sent).toHaveLength(0);
  });

  // THE UNDATED KEY. Unlike `timesheet_awaiting_approval:<id>:<date>`, which
  // re-fires each local day, this one carries no date segment, so the ledger
  // row from the first send blocks it forever. One nudge per relationship.
  it('fires once ever: a second run at the same hour sends nothing', async () => {
    const log = statefulLog();
    const source = candidateSource([scheduleNotSet()]);

    const { push: first, sent: sentFirst } = capturingPush();
    await runReminderJob(source, log, la, oneParent, first, {
      now: () => LA_09_00,
    });
    expect(sentFirst).toHaveLength(1);

    const { push: second, sent: sentSecond } = capturingPush();
    const again = await runReminderJob(source, log, la, oneParent, second, {
      now: () => LA_09_00,
    });

    expect(sentSecond).toHaveLength(0);
    expect(again.scheduleNotSet.sent).toBe(0);
    expect(again.scheduleNotSet.skipped).toBe(1);
  });

  it('keys on the household/carer pair, so each parent is nudged once', async () => {
    const log = statefulLog();
    const { push, sent } = capturingPush();

    await runReminderJob(
      candidateSource([scheduleNotSet()]),
      log,
      la,
      { listParentUserIds: mock(async () => [PARENT_ID, SECOND_PARENT_ID]) },
      push,
      { now: () => LA_09_00 }
    );

    expect(sent.map(s => s.userId)).toEqual([PARENT_ID, SECOND_PARENT_ID]);
    expect(log.claim).toHaveBeenCalledWith(
      PARENT_ID,
      buildScheduleNotSetKey(HOUSEHOLD_ID, CARER_ID)
    );
    expect(log.claim).toHaveBeenCalledWith(
      SECOND_PARENT_ID,
      buildScheduleNotSetKey(HOUSEHOLD_ID, CARER_ID)
    );
  });

  // GOLDEN-FIXES #24 ordering: `canDeliver` runs BEFORE the claim, so an
  // opted-out or quiet-hours-suppressed parent never burns the one ledger
  // slot this undated key will ever have.
  it('burns no ledger slot when canDeliver says no', async () => {
    const log = statefulLog();
    const { push, sent } = capturingPush(false);

    const result = await runReminderJob(
      candidateSource([scheduleNotSet()]),
      log,
      la,
      oneParent,
      push,
      { now: () => LA_09_00 }
    );

    expect(sent).toHaveLength(0);
    expect(log.claim).not.toHaveBeenCalled();
    expect(result.scheduleNotSet.claimed).toBe(0);
    expect(result.scheduleNotSet.skipped).toBe(1);
  });

  it('skips a household with no parents left to ask', async () => {
    const { push, sent } = capturingPush();

    const result = await runReminderJob(
      candidateSource([scheduleNotSet()]),
      statefulLog(),
      la,
      { listParentUserIds: mock(async () => []) },
      push,
      { now: () => LA_09_00 }
    );

    expect(sent).toHaveLength(0);
    expect(result.scheduleNotSet.skipped).toBe(1);
  });

  it('rolls its errors into the job-level errorCount', async () => {
    const { push } = capturingPush();

    const result = await runReminderJob(
      candidateSource([scheduleNotSet()]),
      statefulLog(),
      {
        resolve: mock(async () => {
          throw new Error('timezone lookup exploded');
        }),
      },
      oneParent,
      push,
      { now: () => LA_09_00 }
    );

    expect(result.scheduleNotSet.errors).toBe(1);
    expect(result.errorCount).toBe(1);
  });
});
