import { describe, expect, it, mock } from 'bun:test';
import { TimeOffNotFoundError } from '../../../../../src/domains/availability/errors/availabilityErrors';
import { TimeOffCommandService } from '../../../../../src/domains/availability/services/timeOffCommandService';
import type { CarerTimeOff } from '../../../../../src/domains/availability/types';
import { AuthorizationError, ValidationError } from '../../../../../src/errors';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Format a UTC instant as an ISO string with a fixed numeric offset (e.g. -08:00). */
function toOffsetIso(instant: Date, offsetHours: number): string {
  const local = new Date(instant.getTime() + offsetHours * HOUR_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const h = String(local.getUTCHours()).padStart(2, '0');
  const min = String(local.getUTCMinutes()).padStart(2, '0');
  const sec = String(local.getUTCSeconds()).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '-';
  const absOffset = String(Math.abs(offsetHours)).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}:${sec}${sign}${absOffset}:00`;
}

const CREATE_START = new Date(Date.now() + 28 * DAY_MS).toISOString();
const CREATE_END = new Date(Date.now() + 30 * DAY_MS).toISOString();
const UPDATE_START = new Date(Date.now() + 29 * DAY_MS).toISOString();
const UPDATE_END = new Date(Date.now() + 31 * DAY_MS).toISOString();

const row: CarerTimeOff = {
  id: 't1',
  user_id: 'u1',
  // Anchored to Date.now() rather than a fixed literal: this row backs
  // `update()`'s "reject edits to past time off" check (ends_at vs.
  // Date.now()), and a hardcoded 2026 date is exactly the timebomb that
  // check is designed to catch — it already tripped once. Same convention as
  // shiftChangeRequestCommandService.test.ts's `Date.now() + N` fixtures.
  starts_at: new Date(Date.now() + 28 * DAY_MS).toISOString(),
  ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
  all_day: true,
  kind: 'personal',
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: 't',
  updated_at: 't',
};

function makeTimeOffRepo(overrides: Record<string, unknown> = {}): any {
  return {
    create: mock(async (data: Record<string, unknown>) => ({
      ...row,
      ...data,
      id: 't-new',
    })),
    cancelById: mock(async (id: string) => ({
      ...row,
      id,
      status: 'cancelled',
    })),
    update: mock(async (id: string, data: Record<string, unknown>) => ({
      ...row,
      id,
      ...data,
    })),
    ...overrides,
  };
}

function makeQueries(overrides: Record<string, unknown> = {}): any {
  return {
    getOwned: mock(async () => row),
    // Default: the caller still actively belongs to a household. Every write
    // path asserts this before touching a row — see the gate describe block at
    // the bottom of this file for why.
    assertActiveMember: mock(async () => undefined),
    ...overrides,
  };
}

function makeOverlapRepo(
  shifts: { id: string; household_id: string }[] = []
): any {
  return {
    listConfirmedForCarerInRange: mock(async () => shifts),
    // D77a: not under test here — no shift ever transitions.
    demoteConfirmedToPending: mock(async () => false),
  };
}

describe('TimeOffCommandService.create', () => {
  it('creates a time-off row for the caller', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries(),
      makeOverlapRepo()
    );

    const result = await svc.create('u1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(timeOffRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        starts_at: CREATE_START,
        ends_at: CREATE_END,
        all_day: true,
      })
    );
    expect(result.carer_time_off.id).toBe('t-new');
    expect(result.affected_shift_count).toBe(0);
  });
});

describe('TimeOffCommandService.cancel', () => {
  it("soft-cancels the caller's own row — the repository is called with status: 'cancelled', never a hard delete", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo(),
      undefined,
      // The reconcile is AWAITED now (F-B9-2), so the seam has to be
      // injected here rather than left as the real, network-bound default.
      mock(async () => undefined)
    );

    const result = await svc.cancel('u1', 't1');

    expect(queries.getOwned).toHaveBeenCalledWith('u1', 't1');
    expect(timeOffRepo.cancelById).toHaveBeenCalledWith('t1');
    expect(result.status).toBe('cancelled');
  });

  it("throws TimeOffNotFoundError and never calls cancelById when the row isn't the caller's own", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => {
        throw new TimeOffNotFoundError('t1');
      }),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await expect(svc.cancel('someone-else', 't1')).rejects.toBeInstanceOf(
      TimeOffNotFoundError
    );
    expect(timeOffRepo.cancelById).not.toHaveBeenCalled();
  });

  // Phase 3: a household may already have marked this time off as paid PTO.
  // Cancelling it must reverse that ledger usage, or the carer keeps a paid
  // day she is no longer taking and the balance silently drifts.
  it('reconciles any paid-PTO usage after cancelling', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const reconcile = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries(),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    await svc.cancel('u1', 't1');

    expect(reconcile).toHaveBeenCalledWith('t1');
  });

  // ---------------------------------------------------------------------
  // F-B9-2: the cancel used to commit, fire the PTO reversal and return 200
  // WITHOUT waiting for it. A failed reversal left paid usage standing on a
  // cancelled time off — real money on the ledger for a day nobody is
  // taking — and it could never be repaired, because the conditional cancel
  // made a retried DELETE short-circuit before reaching the reconcile.
  //
  // The reversal is now awaited and its failure is surfaced, and it runs on
  // EVERY cancel rather than only the transitioning one, so the retry that
  // the 503 asks for is the thing that finishes the job. Running it twice is
  // free: `reconcileCancelledTimeOff` writes only what is still outstanding.
  // ---------------------------------------------------------------------
  it('surfaces a retryable failure instead of returning success with a broken ledger', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const reconcile = mock(async () => {
      throw new Error('ledger unavailable');
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries(),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    await expect(svc.cancel('u1', 't1')).rejects.toMatchObject({
      statusCode: 503,
    });
    // The row IS cancelled — only the bookkeeping failed, which is exactly
    // what the retry has to finish.
    expect(timeOffRepo.cancelById).toHaveBeenCalledWith('t1');
  });

  it('reconciles on a RETRIED cancel too, so a failed reversal can still be repaired', async () => {
    const timeOffRepo = makeTimeOffRepo({
      // The row already transitioned on the first (failed) attempt, so the
      // conditional update matches nothing this time.
      cancelById: mock(async () => null),
    });
    const reconcile = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries({
        getOwned: mock(async () => ({ ...row, status: 'cancelled' })),
      }),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    const result = await svc.cancel('u1', 't1');

    expect(reconcile).toHaveBeenCalledWith('t1');
    // Still a success — cancelling an already-cancelled time off is
    // idempotent, and the caller gets the row as it stands.
    expect(result.status).toBe('cancelled');
  });

  it('a second cancel whose reversal also fails still fails loudly', async () => {
    const timeOffRepo = makeTimeOffRepo({ cancelById: mock(async () => null) });
    const reconcile = mock(async () => {
      throw new Error('ledger still unavailable');
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries({
        getOwned: mock(async () => ({ ...row, status: 'cancelled' })),
      }),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    await expect(svc.cancel('u1', 't1')).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('waits for the reversal before returning — never reports success on an unfinished one', async () => {
    let settled = false;
    const reconcile = mock(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      settled = true;
    });
    const svc = new TimeOffCommandService(
      makeTimeOffRepo(),
      makeQueries(),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    await svc.cancel('u1', 't1');

    expect(settled).toBe(true);
  });
});

describe('TimeOffCommandService.update', () => {
  it('updates dates and message on an active row owned by the caller', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    const result = await svc.update('u1', 't1', {
      starts_at: UPDATE_START,
      ends_at: UPDATE_END,
      message: 'Extended by a day',
    });

    expect(queries.getOwned).toHaveBeenCalledWith('u1', 't1');
    expect(timeOffRepo.update).toHaveBeenCalledWith('t1', {
      starts_at: UPDATE_START,
      ends_at: UPDATE_END,
      message: 'Extended by a day',
      sequence: 1,
    });
    expect(result.carer_time_off.message).toBe('Extended by a day');
    expect(result.affected_shift_count).toBe(0);
  });

  it("throws TimeOffNotFoundError and never calls update when the row isn't the caller's own", async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => {
        throw new TimeOffNotFoundError('t1');
      }),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await expect(
      svc.update('someone-else', 't1', { message: 'nope' })
    ).rejects.toBeInstanceOf(TimeOffNotFoundError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('validates the resulting range when only starts_at is patched', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries(),
      makeOverlapRepo()
    );

    // Must land after row.ends_at (now itself Date.now()-relative) to stay a
    // genuine range-invalid case rather than a coincidentally-past literal.
    await expect(
      svc.update('u1', 't1', {
        starts_at: new Date(Date.now() + 31 * DAY_MS).toISOString(),
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('rejects edits to a cancelled row', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => ({ ...row, status: 'cancelled' })),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await expect(
      svc.update('u1', 't1', { message: 'too late' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('rejects status changes via PATCH — cancel stays on DELETE', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries(),
      makeOverlapRepo()
    );

    await expect(
      svc.update('u1', 't1', { status: 'cancelled' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  // The next two cases are constructed so lexicographic string comparison
  // and Date-instant comparison DISAGREE — that's what makes them
  // discriminating against a revert of timeOffCommandService.ts:87 from
  // `Date.parse(effectiveEnds) <= Date.parse(effectiveStarts)` back to a
  // bare `effectiveEnds <= effectiveStarts` string compare. Payloads that
  // merely differ in offset without flipping the ordering (e.g. an ends_at
  // whose calendar day already sorts correctly as a string) pass under
  // EITHER implementation and prove nothing.

  it('rejects a range that is invalid by Date-instant but "valid" by lexicographic string order', async () => {
    // ends_at (stored, no offset): day at 02:00 UTC
    // starts_at (patched, -08:00): previous calendar day 20:00 local = day 04:00 UTC
    // True instants: ends (02:00) is BEFORE starts (04:00) — genuinely invalid.
    // String order: stored ends sorts AFTER patched starts — lexicographic
    // compare says ends > starts, i.e. wrongly "valid". Reverting line 87 to
    // a string compare makes this test's `rejects` assertion fail.
    const rangeBase = new Date(Date.now() + 35 * DAY_MS);
    rangeBase.setUTCHours(2, 0, 0, 0);
    const storedEndsAt = rangeBase.toISOString();
    const startsInstant = new Date(rangeBase.getTime() + 2 * HOUR_MS);
    const patchedStartsAt = toOffsetIso(startsInstant, -8);
    const storedRow = {
      ...row,
      ends_at: storedEndsAt,
    };
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => storedRow),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await expect(
      svc.update('u1', 't1', { starts_at: patchedStartsAt })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('accepts a range that is valid by Date-instant but "invalid" by lexicographic string order — the mirror case', async () => {
    // starts_at (stored, no offset): day at 04:00 UTC
    // ends_at (patched, -08:00): previous calendar day 20:30 local = day 04:30 UTC
    // True instants: ends (04:30) is AFTER starts (04:00) — genuinely valid,
    // a 30-minute span. String order: patched ends sorts BEFORE stored starts
    // — lexicographic compare says ends <= starts, i.e. wrongly "invalid".
    // Reverting line 87 to a string compare makes this throw instead of
    // reaching the repository.
    const rangeBase = new Date(Date.now() + 35 * DAY_MS);
    rangeBase.setUTCHours(4, 0, 0, 0);
    const storedStartsAt = rangeBase.toISOString();
    const endsInstant = new Date(rangeBase.getTime() + 30 * 60 * 1000);
    const patchedEndsAt = toOffsetIso(endsInstant, -8);
    const storedRow = {
      ...row,
      starts_at: storedStartsAt,
    };
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => storedRow),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    const result = await svc.update('u1', 't1', {
      ends_at: patchedEndsAt,
    });

    expect(timeOffRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        ends_at: patchedEndsAt,
        sequence: 1,
      })
    );
    expect(result.carer_time_off.ends_at).toBe(patchedEndsAt);
  });

  it('rejects edits to past time off (ends_at already before now)', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => ({
        ...row,
        starts_at: '2020-01-01T00:00:00Z',
        ends_at: '2020-01-05T00:00:00Z',
      })),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await expect(
      svc.update('u1', 't1', { message: 'too late' })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  it('bumps sequence on every successful PATCH for calendar sync', async () => {
    const storedRow = { ...row, sequence: 3 };
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries({
      getOwned: mock(async () => storedRow),
    });
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await svc.update('u1', 't1', { message: 'note' });

    expect(timeOffRepo.update).toHaveBeenCalledWith('t1', {
      message: 'note',
      sequence: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — the time-off write paths had NO membership gate at all.
// `create` was a bare insert (no household in the URL, the body, or a check),
// and `cancel`/`update` checked `user_id` ownership only. A nanny removed from
// every household she worked for got a 201 on POST, and her DELETE drove
// `reconcileCancelledTimeOff` into a past household's `pto_ledger` — a money
// write by someone who is no longer a member. Pre-existing, but making past
// households selectable in the picker turned it from theoretical into
// reachable. The API uses the service-role key and migration 049 dropped the
// client write policies: this gate is the only one there is.
//
// `carer_time_off` is person-scoped (no household_id on the row), so there is
// no per-household signal to gate on — the honest gate is "does this caller
// still actively belong to ANY household". See the ceiling note on
// `TimeOffQueryService.assertActiveMember`.
// ---------------------------------------------------------------------------
function makeRemovedCallerQueries(
  overrides: Record<string, unknown> = {}
): any {
  return makeQueries({
    assertActiveMember: mock(async () => {
      throw new AuthorizationError(
        'You are no longer a member of any household',
        'NOT_AN_ACTIVE_MEMBER'
      );
    }),
    ...overrides,
  });
}

describe('TimeOffCommandService — active-membership gate', () => {
  it('refuses a create from a caller with no active membership, and writes nothing', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeRemovedCallerQueries(),
      makeOverlapRepo()
    );

    await expect(
      svc.create('removed-nanny', {
        starts_at: CREATE_START,
        ends_at: CREATE_END,
        all_day: true,
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(timeOffRepo.create).not.toHaveBeenCalled();
  });

  // The load-bearing half: the gate must run BEFORE the reconcile, or a
  // removed member's DELETE still appends adjustment rows to a past
  // household's money ledger on its way to failing.
  it('refuses a cancel from a caller with no active membership and attempts NO pto_ledger write', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const reconcile = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeRemovedCallerQueries(),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    await expect(svc.cancel('removed-nanny', 't1')).rejects.toBeInstanceOf(
      AuthorizationError
    );
    expect(reconcile).not.toHaveBeenCalled();
    expect(timeOffRepo.cancelById).not.toHaveBeenCalled();
  });

  it('refuses an update from a caller with no active membership', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeRemovedCallerQueries(),
      makeOverlapRepo()
    );

    await expect(
      svc.update('removed-nanny', 't1', { message: 'nope' })
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(timeOffRepo.update).not.toHaveBeenCalled();
  });

  // Regression pins. A gate that refuses everyone passes all three cases above
  // and takes time off away from every working nanny in the app.
  it('leaves an ACTIVE member able to create', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const queries = makeQueries();
    const svc = new TimeOffCommandService(
      timeOffRepo,
      queries,
      makeOverlapRepo()
    );

    await svc.create('u1', {
      starts_at: CREATE_START,
      ends_at: CREATE_END,
      all_day: true,
    });

    expect(queries.assertActiveMember).toHaveBeenCalledWith('u1');
    expect(timeOffRepo.create).toHaveBeenCalled();
  });

  it('leaves an ACTIVE member able to cancel, reconcile included', async () => {
    const timeOffRepo = makeTimeOffRepo();
    const reconcile = mock(async () => undefined);
    const svc = new TimeOffCommandService(
      timeOffRepo,
      makeQueries(),
      makeOverlapRepo(),
      undefined,
      reconcile
    );

    await svc.cancel('u1', 't1');

    expect(timeOffRepo.cancelById).toHaveBeenCalledWith('t1');
    expect(reconcile).toHaveBeenCalledWith('t1');
  });
});
