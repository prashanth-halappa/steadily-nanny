/**
 * MeQueryService — cross-household "my shifts" + pending change-request feed.
 * @module tests/unit/domains/me/services/meQueryService.test
 */
import { describe, expect, it, mock } from 'bun:test';
import { MeQueryService } from '../../../../../src/domains/me/services/meQueryService';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';

const from = '2026-08-03T00:00:00.000Z';
const to = '2026-08-10T00:00:00.000Z';

function makeShift(
  overrides: Partial<ShiftWithChildren> &
    Pick<ShiftWithChildren, 'id' | 'household_id' | 'carer_id'>
): ShiftWithChildren {
  return {
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
    ical_uid: `uid-${overrides.id}`,
    sequence: 0,
    created_by: null,
    created_at: 't',
    updated_at: 't',
    shift_children: [],
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listActiveByUser: mock(async () => [
      {
        id: 'm1',
        household_id: 'hh-reyes',
        user_id: 'nanny-1',
        role: 'nanny',
        status: 'active',
      },
      {
        id: 'm2',
        household_id: 'hh-cole',
        user_id: 'nanny-1',
        role: 'nanny',
        status: 'active',
      },
      {
        id: 'm3',
        household_id: 'hh-park',
        user_id: 'nanny-1',
        role: 'helper',
        status: 'active',
      },
    ]),
    ...overrides,
  };
}

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findByHouseholdAndRange: mock(async (householdId: string) => {
      if (householdId === 'hh-reyes') {
        return [
          makeShift({
            id: 's-reyes',
            household_id: 'hh-reyes',
            carer_id: 'nanny-1',
            starts_at: '2026-08-03T08:00:00.000Z',
          }),
          // Another carer's shift in the same household — must not appear.
          makeShift({
            id: 's-other',
            household_id: 'hh-reyes',
            carer_id: 'other-carer',
            starts_at: '2026-08-04T08:00:00.000Z',
          }),
        ];
      }
      if (householdId === 'hh-cole') {
        return [
          makeShift({
            id: 's-cole',
            household_id: 'hh-cole',
            carer_id: 'nanny-1',
            starts_at: '2026-08-05T09:00:00.000Z',
          }),
        ];
      }
      if (householdId === 'hh-park') {
        return [
          makeShift({
            id: 's-park',
            household_id: 'hh-park',
            carer_id: 'nanny-1',
            starts_at: '2026-08-06T10:00:00.000Z',
          }),
        ];
      }
      return [];
    }),
    ...overrides,
  };
}

describe('MeQueryService.listMyShifts', () => {
  it("returns the caller's shifts across every household they belong to", async () => {
    const memberRepo = makeMemberRepo();
    const shiftRepo = makeShiftRepo();
    const svc = new MeQueryService(memberRepo, shiftRepo);

    const rows = await svc.listMyShifts('nanny-1', from, to);

    expect(rows.map(r => r.id).sort()).toEqual(['s-cole', 's-park', 's-reyes']);
    expect(shiftRepo.findByHouseholdAndRange).toHaveBeenCalledTimes(3);
    expect(memberRepo.listActiveByUser).toHaveBeenCalledWith('nanny-1');
  });

  it("attaches membership_role per household and excludes other carers' shifts", async () => {
    const svc = new MeQueryService(makeMemberRepo(), makeShiftRepo());
    const rows = await svc.listMyShifts('nanny-1', from, to);

    expect(rows.find(r => r.id === 's-reyes')?.membership_role).toBe('nanny');
    expect(rows.find(r => r.id === 's-park')?.membership_role).toBe('helper');
    expect(rows.some(r => r.id === 's-other')).toBe(false);
  });

  it('returns rows sorted by starts_at ascending', async () => {
    const svc = new MeQueryService(makeMemberRepo(), makeShiftRepo());
    const rows = await svc.listMyShifts('nanny-1', from, to);
    expect(rows.map(r => r.id)).toEqual(['s-reyes', 's-cole', 's-park']);
  });

  it('returns an empty list when the caller has no active memberships', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new MeQueryService(
      makeMemberRepo({ listActiveByUser: mock(async () => []) }),
      shiftRepo
    );
    expect(await svc.listMyShifts('lonely', from, to)).toEqual([]);
    expect(shiftRepo.findByHouseholdAndRange).not.toHaveBeenCalled();
  });
});

function makeChangeRequestRepo(overrides: Record<string, unknown> = {}): any {
  return {
    listPendingByShiftIds: mock(async () => []),
    ...overrides,
  };
}

describe('MeQueryService.listPendingChangeRequestsAwaitingMe', () => {
  it('returns pending requests opened by someone else across memberships', async () => {
    const changeRequestRepo = makeChangeRequestRepo({
      listPendingByShiftIds: mock(async () => [
        {
          id: 'cr-mine',
          shift_id: 's-reyes',
          requested_by: 'nanny-1',
          status: 'pending',
          kind: 'cancel',
        },
        {
          id: 'cr-theirs',
          shift_id: 's-cole',
          requested_by: 'parent-1',
          status: 'pending',
          kind: 'time_change',
        },
      ]),
    });
    const svc = new MeQueryService(
      makeMemberRepo(),
      makeShiftRepo(),
      changeRequestRepo
    );

    const rows = await svc.listPendingChangeRequestsAwaitingMe(
      'nanny-1',
      from,
      to
    );

    expect(rows.map(r => r.id)).toEqual(['cr-theirs']);
    expect(changeRequestRepo.listPendingByShiftIds).toHaveBeenCalledWith(
      expect.arrayContaining(['s-reyes', 's-other', 's-cole', 's-park'])
    );
  });

  it('returns [] without querying shifts when there are no memberships', async () => {
    const shiftRepo = makeShiftRepo();
    const changeRequestRepo = makeChangeRequestRepo();
    const svc = new MeQueryService(
      makeMemberRepo({ listActiveByUser: mock(async () => []) }),
      shiftRepo,
      changeRequestRepo
    );

    expect(
      await svc.listPendingChangeRequestsAwaitingMe('lonely', from, to)
    ).toEqual([]);
    expect(shiftRepo.findByHouseholdAndRange).not.toHaveBeenCalled();
    expect(changeRequestRepo.listPendingByShiftIds).not.toHaveBeenCalled();
  });
});
