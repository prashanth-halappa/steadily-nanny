/**
 * ShiftCommandService.update — parent edit goes through applyParentEdit RPC
 * so the shift row and shift_updated event are written atomically (D23/D24).
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import type { ShiftWithChildren } from '../../../../../src/domains/shift/repositories/shiftRepository';
import { ShiftCommandService } from '../../../../../src/domains/shift/services/shiftCommandService';
import { ValidationError } from '../../../../../src/errors';

const shift: ShiftWithChildren = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
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
  ical_uid: 'uid-1',
  sequence: 0,
  created_by: null,
  created_at: 't',
  updated_at: 't',
  shift_children: [],
};

function makeShiftRepo(overrides: Record<string, unknown> = {}): any {
  return {
    applyParentEdit: mock(async (args: Record<string, unknown>) => ({
      ...shift,
      starts_at: args.setStartsAt ? args.startsAt : shift.starts_at,
      ends_at: args.setEndsAt ? args.endsAt : shift.ends_at,
      note: args.setNote ? args.note : shift.note,
      origin: args.origin,
      sequence: args.sequence,
    })),
    ...overrides,
  };
}

function makeMemberRepo(overrides: Record<string, unknown> = {}): any {
  return {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'parent-1',
      role: 'parent',
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => shift),
    ...overrides,
  };
}

describe('ShiftCommandService.update', () => {
  it('applies the edit via RPC with origin parent_proposed, bumped sequence, and before/after payload', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries()
    );

    await svc.update('parent-1', 's1', {
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T18:00:00.000Z',
    });

    expect(shiftRepo.applyParentEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftId: 's1',
        actorId: 'parent-1',
        startsAt: '2026-08-03T09:00:00.000Z',
        endsAt: '2026-08-03T18:00:00.000Z',
        setStartsAt: true,
        setEndsAt: true,
        setNote: false,
        origin: 'parent_proposed',
        sequence: 1,
        before: expect.objectContaining({
          starts_at: shift.starts_at,
          ends_at: shift.ends_at,
        }),
        after: expect.objectContaining({
          starts_at: '2026-08-03T09:00:00.000Z',
          ends_at: '2026-08-03T18:00:00.000Z',
          origin: 'parent_proposed',
          sequence: 1,
        }),
      })
    );
  });

  it('allows a note-only edit, leaving times untouched', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries()
    );

    await svc.update('parent-1', 's1', { note: 'Running 15 min late' });

    expect(shiftRepo.applyParentEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        note: 'Running 15 min late',
        setNote: true,
        setStartsAt: false,
        setEndsAt: false,
        origin: 'parent_proposed',
      })
    );
  });

  it('validates a one-sided starts_at edit against the EXISTING ends_at', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries()
    );

    await expect(
      svc.update('parent-1', 's1', { starts_at: '2026-08-03T18:00:00.000Z' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(shiftRepo.applyParentEdit).not.toHaveBeenCalled();
  });

  it('rejects a nanny (non-parent) trying to edit', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo({
        findActiveMembership: mock(async () => ({
          id: 'm2',
          household_id: 'h1',
          user_id: 'carer-1',
          role: 'nanny',
        })),
      }),
      makeQueries()
    );

    await expect(
      svc.update('carer-1', 's1', { note: 'Can I change this?' })
    ).rejects.toBeInstanceOf(NotAHouseholdParentError);
    expect(shiftRepo.applyParentEdit).not.toHaveBeenCalled();
  });
});
