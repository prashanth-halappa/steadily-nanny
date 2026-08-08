/**
 * Cancellation-pay reconcile job — repairs shifts left flagged
 * `cancellation_paid` with no payable `time_entries` row behind them.
 */
import { describe, expect, it, mock } from 'bun:test';
import { TimeEntryNotEditableError } from '../../../src/domains/timesheet/errors/timesheetErrors';
import { runCancellationPayReconcileJob } from '../../../src/jobs/cancellationPayReconcileJob';

const stuckShift = {
  id: 's1',
  household_id: 'h1',
  carer_id: 'carer-1',
  starts_at: '2026-08-03T08:00:00.000Z',
  ends_at: '2026-08-03T17:00:00.000Z',
  timezone: 'Europe/London',
  status: 'cancelled',
  cancellation_paid: true,
} as any;

function makeShiftRepo(shifts = [stuckShift]) {
  return { listCancellationPaidSince: mock(async () => shifts) };
}

/** Nothing recorded for the shift — the finder's only remaining question. */
function makeEntries(found: unknown = null) {
  return { findCancellationPaidForShift: mock(async () => found) } as any;
}

describe('runCancellationPayReconcileJob', () => {
  it('creates the missing payable entry for a stuck shift', async () => {
    const shiftRepo = makeShiftRepo();
    const recorder = mock(async () => [{ id: 'te1' }] as any);

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries(),
      recorder
    );

    expect(recorder).toHaveBeenCalledWith(stuckShift);
    expect(result.repaired).toBe(1);
    expect(result.checked).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  // THE BUG. Migration 053 lets a cancelled window pay out as SEVERAL
  // fragments. `findCancellationPaidForShift` can only answer "does at least
  // one exist", so a half-written remainder — fragment 1 committed, fragment 2
  // failed — used to read as settled and got skipped forever. That is the
  // exact state this job exists to repair.
  it('repairs a half-written split remainder instead of reading it as settled', async () => {
    const shiftRepo = makeShiftRepo();
    // The recorder is self-healing: already-written rows come back from the
    // overlap query and are subtracted, so it writes only the missing gap.
    const recorder = mock(async () => [{ id: 'te-fragment-2' }] as any);

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries({ id: 'te-fragment-1' }),
      recorder
    );

    expect(recorder).toHaveBeenCalledWith(stuckShift);
    expect(result.repaired).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  // The recorder is the only thing that can answer "is anything still owed",
  // and it answers by returning what it WROTE. An empty array means the
  // arithmetic found no gap — nothing was repaired, so nothing is counted.
  it('counts nothing repaired when the recorder finds no missing fragment', async () => {
    const shiftRepo = makeShiftRepo();
    const recorder = mock(async () => [] as any);

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries({ id: 'te1' }),
      recorder
    );

    expect(recorder).toHaveBeenCalled();
    expect(result.repaired).toBe(0);
    expect(result.checked).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.stillUnpaidCount).toBe(0);
  });

  // `[]` is ALSO what a carer clocked in across the window produces: her open
  // `[clock_in, ∞)` session covers the remainder, so nothing is owed YET and
  // the accept returns 200 with `cancellation_paid = true` standing over no
  // payable row. That self-heals once she clocks out — but until it does it is
  // a silent underpay, and no counter could see it.
  it('flags a paid cancellation that still has no payable entry at all', async () => {
    const shiftRepo = makeShiftRepo();
    const recorder = mock(async () => [] as any);

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries(null),
      recorder
    );

    expect(result.stillUnpaidCount).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.needsHumanCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('flags a paid cancellation when the only cancellation_paid row is voided — voided is not pay', async () => {
    const shiftRepo = makeShiftRepo();
    const recorder = mock(async () => [] as any);

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries({
        id: 'te-voided',
        kind: 'cancellation_paid',
        status: 'voided',
      }),
      recorder
    );

    expect(recorder).toHaveBeenCalledWith(stuckShift);
    expect(result.stillUnpaidCount).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  // The one failure no retry can ever settle: the week is already approved, so
  // the entry is refused deterministically. It has to be counted apart from
  // transient errors, because it needs a human, not another run.
  it('counts an approved-week block separately and keeps going', async () => {
    const second = { ...stuckShift, id: 's2' };
    const shiftRepo = makeShiftRepo([stuckShift, second]);
    const recorder = mock(async (shift: { id: string }) => {
      if (shift.id === 's1') {
        throw new TimeEntryNotEditableError('new', 'week_approved');
      }
      return [{ id: 'te2' }] as any;
    });

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries(),
      recorder
    );

    expect(result.checked).toBe(2);
    expect(result.needsHumanCount).toBe(1);
    expect(result.repaired).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  // Approving a week is the NORMAL end state of a settled paid cancellation,
  // and the recorder checks the approved week before it computes remainders —
  // so a perfectly healthy shift throws here for the whole 30-day lookback.
  // Counting those as needing a human would bury the real ones.
  it('does not escalate an approved week that already has cancellation pay recorded', async () => {
    const shiftRepo = makeShiftRepo();
    const recorder = mock(async () => {
      throw new TimeEntryNotEditableError('new', 'week_approved');
    });

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries({ id: 'te1' }),
      recorder
    );

    expect(result.needsHumanCount).toBe(0);
    expect(result.repaired).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('still counts a transient failure as an error', async () => {
    const shiftRepo = makeShiftRepo();
    const recorder = mock(async () => {
      throw new Error('db blip');
    });

    const result = await runCancellationPayReconcileJob(
      shiftRepo,
      makeEntries(),
      recorder
    );

    expect(result.errorCount).toBe(1);
    expect(result.needsHumanCount).toBe(0);
    expect(result.repaired).toBe(0);
  });
});
