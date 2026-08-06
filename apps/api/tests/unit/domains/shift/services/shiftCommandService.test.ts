/**
 * ShiftCommandService.update — parent edit goes through applyParentEdit RPC
 * so the shift row and shift_updated event are written atomically (D23/D24).
 */
import { describe, expect, it, mock } from 'bun:test';
import { NotAHouseholdParentError } from '../../../../../src/domains/household';
import { ShiftImmutableError } from '../../../../../src/domains/shift/errors/shiftErrors';
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
    // The sequence is decided by the RPC from the row it locks, never echoed
    // back from the caller's args — the fake models that.
    applyParentEdit: mock(async (args: Record<string, unknown>) => ({
      ...shift,
      starts_at: args.setStartsAt ? args.startsAt : shift.starts_at,
      ends_at: args.setEndsAt ? args.endsAt : shift.ends_at,
      note: args.setNote ? args.note : shift.note,
      origin: args.origin,
      sequence: shift.sequence + 1,
    })),
    // Settled-reality guard. `applyParentEdit` is an RPC, so it bypasses the
    // repository's guarded `update()` — the service has to ask. Open by
    // default in these fakes.
    assertMutable: mock(async () => undefined),
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
  it('applies the edit via RPC with origin parent_proposed and the edit intent only', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries()
    );

    const result = await svc.update('parent-1', 's1', {
      starts_at: '2026-08-03T09:00:00.000Z',
      ends_at: '2026-08-03T18:00:00.000Z',
    });

    expect(shiftRepo.applyParentEdit).toHaveBeenCalledWith({
      shiftId: 's1',
      actorId: 'parent-1',
      startsAt: '2026-08-03T09:00:00.000Z',
      endsAt: '2026-08-03T18:00:00.000Z',
      note: null,
      setStartsAt: true,
      setEndsAt: true,
      setNote: false,
      origin: 'parent_proposed',
    });
    // The bumped sequence comes back from the RPC (which derived it under
    // lock); the service never computes one.
    expect(result.sequence).toBe(1);
  });

  it('does not derive the audit record from the stale pre-read', async () => {
    // The exact race migration 027 exists to close: the parent's ownership
    // read sees sequence=3, a nanny accept commits sequence=4, then the RPC
    // takes the lock and the row correctly becomes 5. ANY sequence or
    // before/after snapshot the service computes from its own pre-read is
    // stale by construction (it would say 3 -> 4, and describe a starts_at
    // that has already been overwritten), so none may be sent at all — the
    // audit record is derived under lock in SQL.
    const staleRead = { ...shift, sequence: 3 };
    const appliedRow = {
      ...shift,
      starts_at: '2026-08-03T09:00:00.000Z',
      origin: 'parent_proposed',
      sequence: 5,
    };
    const shiftRepo = makeShiftRepo({
      applyParentEdit: mock(async () => appliedRow),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries({ getOwned: mock(async () => staleRead) })
    );

    const result = await svc.update('parent-1', 's1', {
      starts_at: '2026-08-03T09:00:00.000Z',
    });

    const args = shiftRepo.applyParentEdit.mock.calls[0][0];
    expect(args).not.toHaveProperty('sequence');
    expect(args).not.toHaveProperty('before');
    expect(args).not.toHaveProperty('after');
    expect(result.sequence).toBe(5);
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

  it('compares the effective range chronologically, not as strings', async () => {
    // Stored times come back from PostgREST in `+00:00` form, client edits
    // arrive in `.000Z` form; a string compare of the two serialisations of
    // the SAME instant wrongly lets this zero-length range through.
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries({
        getOwned: mock(async () => ({
          ...shift,
          starts_at: '2026-08-03T08:00:00+00:00',
        })),
      })
    );

    await expect(
      svc.update('parent-1', 's1', { ends_at: '2026-08-03T08:00:00.000Z' })
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

  // F-B5-2. PATCH /shifts/:id reached the RPC without ever asking whether the
  // carer had clocked in. Rewriting the span mid-shift corrupts the consent
  // trail and freezes `scheduled_minutes` from the EDITED times on clock-out.
  it('refuses a time edit once someone has clocked into the shift', async () => {
    const shiftRepo = makeShiftRepo({
      assertMutable: mock(async () => {
        throw new ShiftImmutableError('s1', 'confirmed', 'has_time_entries');
      }),
    });
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries()
    );

    await expect(
      svc.update('parent-1', 's1', { ends_at: '2026-08-03T15:00:00.000Z' })
    ).rejects.toBeInstanceOf(ShiftImmutableError);
    expect(shiftRepo.applyParentEdit).not.toHaveBeenCalled();
  });

  it('asks the settled-reality guard before every edit, note-only included', async () => {
    const shiftRepo = makeShiftRepo();
    const svc = new ShiftCommandService(
      shiftRepo,
      makeMemberRepo(),
      makeQueries()
    );

    await svc.update('parent-1', 's1', { note: 'Running 15 min late' });

    expect(shiftRepo.assertMutable).toHaveBeenCalledWith('s1');
  });
});
