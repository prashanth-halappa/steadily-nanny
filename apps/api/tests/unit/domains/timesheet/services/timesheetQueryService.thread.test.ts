/**
 * The week thread's READ gate (D-18, gap P1).
 *
 * The whole point of D-18 is that the nanny can read what was said about her
 * pay, so the gate here is the WIDE one — `getReadableTimesheet`, the same
 * gate the week read itself uses, which a member removed from the household
 * still passes for her own rows. Wiring the narrower action gate in would
 * hand P1 straight back.
 *
 * And it must stay OUT of `makeOwnershipValidator` on the route
 * (GOLDEN-FIXES #32): the validator caches by `(userId, resourceId)` with no
 * lookup identity, so one permitted thread read would leave a positive entry
 * `/approve` then reuses.
 */
import { describe, expect, it, mock } from 'bun:test';
import { TIMESHEET_THREAD_MESSAGE_KINDS } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { TimesheetNotFoundError } from '../../../../../src/domains/timesheet/errors/timesheetErrors';
import { TimesheetQueryService } from '../../../../../src/domains/timesheet/services/timesheetQueryService';

const DAY_MS = 24 * 60 * 60 * 1000;
const queriedInstant = new Date(Date.now() - 14 * DAY_MS);
queriedInstant.setUTCHours(17, 4, 0, 0);
const THREAD_QUERIED_AT = queriedInstant
  .toISOString()
  .replace('.000Z', '+00:00');
const THREAD_REPLY_AT = new Date(
  queriedInstant.getTime() + (2 * 60 + 16) * 60 * 1000
).toISOString();
const THREAD_UPDATED_AT = queriedInstant.toISOString();

const timesheet = {
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
  // GOLDEN-FIXES #25 — both serialisations across this file's fixtures.
  created_at: '2026-08-03T00:00:00+00:00',
  updated_at: THREAD_UPDATED_AT,
};

const queriedEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  household_id: 'h1',
  shift_id: null,
  local_date: '2026-08-03',
  actor_id: 'parent-1',
  event_type: 'timesheet_queried',
  payload: { timesheetId: 'ts1', note: 'Thursday looks long' },
  created_at: THREAD_QUERIED_AT,
};

const replyEvent = {
  id: '22222222-2222-4222-8222-222222222222',
  household_id: 'h1',
  shift_id: null,
  local_date: '2026-08-03',
  actor_id: 'carer-1',
  event_type: 'timesheet_note_added',
  payload: { timesheetId: 'ts1', message: 'I stayed late.' },
  created_at: THREAD_REPLY_AT,
};

function makeService(overrides: Record<string, unknown> = {}): any {
  const deps = {
    timesheetRepo: {
      findById: mock(async () => timesheet),
    } as any,
    memberRepo: {
      findMembershipAnyStatus: mock(async () => ({
        id: 'm1',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
        status: 'active',
      })),
      findActiveMembership: mock(async () => ({
        id: 'm1',
        household_id: 'h1',
        user_id: 'carer-1',
        role: 'nanny',
        status: 'active',
      })),
    } as any,
    householdRepo: {
      findById: mock(async () => ({
        id: 'h1',
        name: 'The Ahmeds',
        timezone: 'Europe/London',
      })),
    } as any,
    eventRepo: {
      listForHouseholdDate: mock(async () => [queriedEvent, replyEvent]),
    } as any,
    ...overrides,
  };
  return {
    ...deps,
    svc: new TimesheetQueryService(
      {} as any,
      deps.timesheetRepo,
      deps.memberRepo,
      deps.householdRepo,
      {} as any,
      {} as any,
      deps.eventRepo
    ),
  };
}

describe('TimesheetQueryService.getThread', () => {
  it('gives the CARER every message, named, oldest first (D-18 closes P1)', async () => {
    const { svc } = makeService();

    const thread = await svc.getThread('carer-1', 'ts1');

    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]).toMatchObject({
      kind: TIMESHEET_THREAD_MESSAGE_KINDS.QUERIED,
      author_name: 'The Ahmeds',
      body: 'Thursday looks long',
    });
    expect(thread.messages[1]).toMatchObject({
      kind: TIMESHEET_THREAD_MESSAGE_KINDS.NOTE,
      author_id: 'carer-1',
      author_name: 'Priya Nair',
    });
  });

  it('reads the day thread at the WEEK START, in the timesheet household', async () => {
    const { svc, eventRepo } = makeService();

    await svc.getThread('carer-1', 'ts1');

    expect(eventRepo.listForHouseholdDate).toHaveBeenCalledWith(
      'h1',
      '2026-08-03'
    );
  });

  it('returns an empty thread rather than throwing on a clean week (D16)', async () => {
    const { svc } = makeService({
      eventRepo: { listForHouseholdDate: mock(async () => []) } as any,
    });

    expect(await svc.getThread('carer-1', 'ts1')).toEqual({ messages: [] });
  });

  it('404s opaquely for a stranger — same error as a missing week', async () => {
    const { svc } = makeService({
      memberRepo: {
        findMembershipAnyStatus: mock(async () => null),
        findActiveMembership: mock(async () => null),
      } as any,
    });

    await expect(svc.getThread('stranger', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotFoundError
    );
  });

  it("404s a removed nanny reading another carer's week, not her own", async () => {
    const { svc } = makeService({
      timesheetRepo: {
        findById: mock(async () => ({ ...timesheet, carer_id: 'carer-2' })),
      } as any,
      memberRepo: {
        findMembershipAnyStatus: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'removed',
        })),
      } as any,
    });

    await expect(svc.getThread('carer-1', 'ts1')).rejects.toBeInstanceOf(
      TimesheetNotFoundError
    );
  });

  it('lets a REMOVED nanny keep reading her own record (payroll is an audit trail)', async () => {
    const { svc } = makeService({
      memberRepo: {
        findMembershipAnyStatus: mock(async () => ({
          id: 'm1',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
          status: 'removed',
        })),
        findActiveMembership: mock(async () => null),
      } as any,
    });

    expect((await svc.getThread('carer-1', 'ts1')).messages).toHaveLength(2);
  });

  it('falls back to a neutral household label when the household has no name', async () => {
    const { svc } = makeService({
      householdRepo: {
        findById: mock(async () => ({ id: 'h1', name: '  ' })),
      } as any,
    });

    const thread = await svc.getThread('carer-1', 'ts1');
    expect(thread.messages[0]?.author_name).toBe('The family');
  });
});
