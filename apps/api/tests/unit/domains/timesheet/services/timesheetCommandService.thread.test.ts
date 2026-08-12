/**
 * The week thread's WRITES (D-18 / D-19 / D-46,
 * `docs/design/attention-and-notifications.md` §3 + §3.1).
 *
 * WHAT IS PINNED HERE
 *  1. **Both sides can speak, and the append is not best-effort.** Every
 *     other `shift_events` append in this service is a swallowed audit; this
 *     one IS the message, so a failed insert must fail the request rather
 *     than silently eat what someone typed.
 *  2. **Who may speak, when.** The carer may speak on a `submitted`,
 *     `queried` or `approved` week — §3.1's "This doesn't look right" is the
 *     entry point on the last two and changes NO status. A parent may speak
 *     only while the week is `queried`: on an approved week the thread is
 *     history, not a chat. A helper is in neither set and may not speak at
 *     all.
 *  3. **N3 goes to whoever did not write it** (§1.4). One type for the whole
 *     thread, body carrying the message trimmed to 140.
 *  4. **Withdraw is a CAS'd `queried` → `submitted`** on the same
 *     `updated_at` predicate as approve/query (D-19), and it does NOT clear
 *     the thread — that is the second sentence of the confirm dialog and it
 *     is load-bearing for both personas.
 *  5. **A re-query supersedes rather than blocks** (D-19): querying a week
 *     that was queried before appends, it does not refuse.
 */
import { describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  NotATimesheetParentError,
  TimesheetNotActionableError,
} from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import { TimesheetCommandService } from '../../../../../src/domains/timesheet/services/timesheetCommandService';

const DAY_MS = 24 * 60 * 60 * 1000;
const queriedInstant = new Date(Date.now() - 14 * DAY_MS);
queriedInstant.setUTCHours(17, 4, 0, 0);
const THREAD_UPDATED_AT = queriedInstant.toISOString();

// GOLDEN-FIXES #25 — both timestamp serialisations across the fixtures.
const queriedTimesheet = {
  id: 'ts1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Priya Nair',
  week_start: '2026-08-03',
  total_minutes: 480,
  status: 'queried',
  approved_by: null,
  approved_at: null,
  query_note: 'Thursday looks long',
  reopen_reason: null,
  created_at: '2026-08-03T00:00:00+00:00',
  updated_at: THREAD_UPDATED_AT,
};

const parentMembership = {
  id: 'm1',
  household_id: 'h1',
  user_id: 'parent-1',
  role: 'parent',
  status: 'active',
};

function makeService(overrides: Record<string, unknown> = {}): any {
  const timesheet = (overrides.timesheet ?? queriedTimesheet) as Record<
    string,
    unknown
  >;
  const deps = {
    timesheetRepo: {
      withdrawQueryFromQueried: mock(async () => ({
        ...timesheet,
        status: 'submitted',
        query_note: null,
      })),
      ...((overrides.timesheetRepo as object) ?? {}),
    } as any,
    memberRepo: {
      findActiveMembership: mock(async () => parentMembership),
      ...((overrides.memberRepo as object) ?? {}),
    } as any,
    householdRepo: {
      findById: mock(async () => ({ id: 'h1', name: 'The Ahmeds' })),
    } as any,
    queries: {
      getOwnedTimesheet: mock(async () => timesheet),
      getThread: mock(async () => ({ messages: [] })),
      ...((overrides.queries as object) ?? {}),
    } as any,
    push: {
      notifyUser: mock(() => undefined),
      notifyHouseholdParents: mock(() => undefined),
    } as any,
    eventRepo: {
      insertMany: mock(async () => []),
      ...((overrides.eventRepo as object) ?? {}),
    } as any,
  };
  return {
    ...deps,
    svc: new TimesheetCommandService(
      {} as any,
      deps.timesheetRepo,
      deps.memberRepo,
      deps.householdRepo,
      {} as any,
      deps.queries,
      {} as any,
      deps.push,
      {} as any,
      deps.eventRepo
    ),
  };
}

describe('addThreadMessage — both sides can speak (D-18)', () => {
  it('appends the carer’s reply as a timesheet_note_added day-thread row', async () => {
    const { svc, eventRepo } = makeService({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          ...parentMembership,
          user_id: 'carer-1',
          role: 'nanny',
        })),
      },
    });

    await svc.addThreadMessage('carer-1', 'ts1', {
      message: "I stayed late — Ayla's pickup ran over.",
    });

    expect(eventRepo.insertMany).toHaveBeenCalledTimes(1);
    const [[events]] = eventRepo.insertMany.mock.calls as [
      [Record<string, unknown>[]],
    ];
    const event = events[0];
    expect(event).toEqual({
      household_id: 'h1',
      shift_id: null,
      local_date: '2026-08-03',
      actor_id: 'carer-1',
      event_type: 'timesheet_note_added',
      payload: {
        timesheetId: 'ts1',
        weekStart: '2026-08-03',
        message: "I stayed late — Ayla's pickup ran over.",
      },
    });
  });

  it('returns the whole updated thread, not just the new row', async () => {
    const { svc } = makeService({
      queries: {
        getThread: mock(async () => ({
          messages: [{ id: 'a' }, { id: 'b' }],
        })),
      },
    });

    const thread = await svc.addThreadMessage('parent-1', 'ts1', {
      message: 'ok',
    });

    expect(thread.messages).toHaveLength(2);
  });

  it('FAILS the request when the append fails — the message is not an audit crumb', async () => {
    const { svc } = makeService({
      eventRepo: {
        insertMany: mock(async () => {
          throw new Error('db down');
        }),
      },
    });

    await expect(
      svc.addThreadMessage('parent-1', 'ts1', { message: 'ok' })
    ).rejects.toThrow('db down');
  });

  it('lets the carer open a thread on a SUBMITTED week and changes no status (D-46)', async () => {
    const { svc, timesheetRepo } = makeService({
      timesheet: { ...queriedTimesheet, status: 'submitted', query_note: null },
      memberRepo: {
        findActiveMembership: mock(async () => ({
          ...parentMembership,
          user_id: 'carer-1',
          role: 'nanny',
        })),
      },
    });

    await svc.addThreadMessage('carer-1', 'ts1', {
      message: "This doesn't look right",
    });

    expect(timesheetRepo.withdrawQueryFromQueried).not.toHaveBeenCalled();
  });

  it('lets the carer speak on an APPROVED week — an approved week with wrong arithmetic is the lived case', async () => {
    const { svc } = makeService({
      timesheet: { ...queriedTimesheet, status: 'approved', query_note: null },
      memberRepo: {
        findActiveMembership: mock(async () => ({
          ...parentMembership,
          user_id: 'carer-1',
          role: 'nanny',
        })),
      },
    });

    await expect(
      svc.addThreadMessage('carer-1', 'ts1', { message: 'the total is short' })
    ).resolves.toBeDefined();
  });

  it('refuses a PARENT on an approved week — history, not a chat (§3)', async () => {
    const { svc } = makeService({
      timesheet: { ...queriedTimesheet, status: 'approved', query_note: null },
    });

    await expect(
      svc.addThreadMessage('parent-1', 'ts1', { message: 'hello' })
    ).rejects.toBeInstanceOf(TimesheetNotActionableError);
  });

  it('refuses a HELPER outright — she is in neither role set', async () => {
    const { svc } = makeService({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          ...parentMembership,
          user_id: 'helper-1',
          role: 'helper',
        })),
      },
    });

    await expect(
      svc.addThreadMessage('helper-1', 'ts1', { message: 'hello' })
    ).rejects.toBeInstanceOf(NotATimesheetParentError);
  });

  it('pushes N3 to the CARER when a parent wrote it', async () => {
    const { svc, push } = makeService();

    await svc.addThreadMessage('parent-1', 'ts1', {
      message: 'Can you check Thursday?',
    });

    expect(push.notifyHouseholdParents).not.toHaveBeenCalled();
    expect(push.notifyUser).toHaveBeenCalledTimes(1);
    const [userId, payload] = push.notifyUser.mock.calls[0] as [
      string,
      { body: string; data: Record<string, unknown> },
    ];
    expect(userId).toBe('carer-1');
    expect(payload.body).toBe('Can you check Thursday?');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.TIMESHEET_NOTE_ADDED,
      timesheetId: 'ts1',
      householdId: 'h1',
      weekStart: '2026-08-03',
    });
  });

  it('pushes N3 to the PARENTS when the carer wrote it, excluding nobody', async () => {
    const { svc, push } = makeService({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          ...parentMembership,
          user_id: 'carer-1',
          role: 'nanny',
        })),
      },
    });

    await svc.addThreadMessage('carer-1', 'ts1', { message: 'I stayed late.' });

    expect(push.notifyUser).not.toHaveBeenCalled();
    expect(push.notifyHouseholdParents).toHaveBeenCalledTimes(1);
    const [householdId, payload] = push.notifyHouseholdParents.mock
      .calls[0] as [string, { data: Record<string, unknown> }];
    expect(householdId).toBe('h1');
    expect(payload.data).toMatchObject({
      type: PUSH_NOTIFICATION_TYPES.TIMESHEET_NOTE_ADDED,
    });
  });

  it('trims the push body to 140 characters with an ellipsis (§1.4)', async () => {
    const { svc, push } = makeService();

    await svc.addThreadMessage('parent-1', 'ts1', { message: 'x'.repeat(400) });

    const [, payload] = push.notifyUser.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(payload.body).toHaveLength(140);
    expect(payload.body.endsWith('…')).toBe(true);
  });

  it('never lets a push failure lose a message that is already on the record', async () => {
    const { svc, push } = makeService();
    push.notifyUser.mockImplementation(() => {
      throw new Error('expo down');
    });

    await expect(
      svc.addThreadMessage('parent-1', 'ts1', { message: 'ok' })
    ).resolves.toBeDefined();
  });
});

describe('withdrawQuery — the parent’s exit from queried (D-19, gap P2)', () => {
  it('CAS’s queried → submitted on the updated_at it read', async () => {
    const { svc, timesheetRepo } = makeService();

    const result = await svc.withdrawQuery('parent-1', 'ts1');

    expect(timesheetRepo.withdrawQueryFromQueried).toHaveBeenCalledWith(
      'ts1',
      THREAD_UPDATED_AT
    );
    expect(result.status).toBe('submitted');
  });

  it('appends a timesheet_query_withdrawn day-thread row and clears nothing else', async () => {
    const { svc, eventRepo } = makeService();

    await svc.withdrawQuery('parent-1', 'ts1');

    const [[events]] = eventRepo.insertMany.mock.calls as [
      [Record<string, unknown>[]],
    ];
    const event = events[0];
    expect(event).toMatchObject({
      household_id: 'h1',
      shift_id: null,
      local_date: '2026-08-03',
      actor_id: 'parent-1',
      event_type: 'timesheet_query_withdrawn',
      payload: { timesheetId: 'ts1', weekStart: '2026-08-03' },
    });
  });

  it('pushes N4 to the carer', async () => {
    const { svc, push } = makeService();

    await svc.withdrawQuery('parent-1', 'ts1');

    const [userId, payload] = push.notifyUser.mock.calls[0] as [
      string,
      { data: Record<string, unknown> },
    ];
    expect(userId).toBe('carer-1');
    expect(payload.data).toEqual({
      type: PUSH_NOTIFICATION_TYPES.TIMESHEET_QUERY_WITHDRAWN,
      timesheetId: 'ts1',
      householdId: 'h1',
      weekStart: '2026-08-03',
    });
  });

  it('refuses a week that is not queried', async () => {
    const { svc } = makeService({
      timesheet: { ...queriedTimesheet, status: 'submitted' },
    });

    await expect(svc.withdrawQuery('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotActionableError
    );
  });

  it('turns a lost CAS race into the same status-race error, not a silent no-op', async () => {
    const { svc } = makeService({
      timesheetRepo: { withdrawQueryFromQueried: mock(async () => null) },
    });

    await expect(svc.withdrawQuery('parent-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotActionableError
    );
  });

  it('is parent-only — the carer cannot withdraw a question asked of her', async () => {
    const { svc } = makeService({
      memberRepo: {
        findActiveMembership: mock(async () => ({
          ...parentMembership,
          user_id: 'carer-1',
          role: 'nanny',
        })),
      },
    });

    await expect(svc.withdrawQuery('carer-1', 'ts1')).rejects.toBeInstanceOf(
      NotATimesheetParentError
    );
  });
});

describe('query — the push now carries the note (D-18, §1.4)', () => {
  it('sends the note as the body rather than a generic sentence', async () => {
    const { svc, push } = makeService({
      timesheet: { ...queriedTimesheet, status: 'submitted', query_note: null },
      timesheetRepo: {
        queryFromActionable: mock(async () => ({
          ...queriedTimesheet,
          query_note: 'Thursday looks about 90 minutes long — can you check?',
        })),
      },
    });

    await svc.query('parent-1', 'ts1', {
      note: 'Thursday looks about 90 minutes long — can you check?',
    });

    const [, payload] = push.notifyUser.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(payload.body).toBe(
      'Thursday looks about 90 minutes long — can you check?'
    );
  });

  it('supersedes rather than blocks a re-query of an already-queried week (D-19)', async () => {
    const { svc, timesheetRepo } = makeService({
      timesheetRepo: {
        queryFromActionable: mock(async () => queriedTimesheet),
      },
    });

    await expect(
      svc.query('parent-1', 'ts1', { note: 'And Friday too.' })
    ).resolves.toBeDefined();
    expect(timesheetRepo.queryFromActionable).toHaveBeenCalled();
  });
});
