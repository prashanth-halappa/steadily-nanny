/**
 * Job-run summary mappers.
 *
 * The reconcile job counts three distinct bad outcomes and only one of them
 * lands in `errorCount`. `needsHumanCount` (pay owed on an already-approved
 * week) and `stillUnpaidCount` (flag standing, nothing payable on file) are
 * both "a carer is not getting paid" — reporting them as a healthy run is how
 * an unpaid carer stays unpaid for thirty days of hourly runs.
 */
import { describe, expect, test } from 'bun:test';
import { mapReconcileForJobRun } from '../../../src/controllers/jobController';

const baseResult = {
  checked: 10,
  repaired: 4,
  needsHumanCount: 0,
  stillUnpaidCount: 0,
  errorCount: 0,
  message: 'x',
};

describe('mapReconcileForJobRun', () => {
  test('a fully settled run reports no errors', () => {
    expect(mapReconcileForJobRun(baseResult)).toMatchObject({
      totalProcessed: 10,
      successCount: 4,
      errorCount: 0,
    });
  });

  test('folds needsHuman into errorCount, but not stillUnpaid', () => {
    const summary = mapReconcileForJobRun({
      ...baseResult,
      needsHumanCount: 1,
      stillUnpaidCount: 2,
      errorCount: 3,
    });

    expect(summary.errorCount).toBe(4);
    // Both counts stay in the summary so the job_runs row still says WHICH
    // kind of outcome it was — the fold is for alerting, not for erasing
    // detail.
    expect(summary).toMatchObject({ needsHumanCount: 1, stillUnpaidCount: 2 });
  });

  test('an unrepairable approved week alone is enough to fail the run', () => {
    // errorCount 0, nothing threw, nothing repaired — and one carer owed
    // money on a week no retry can settle. JobRunService derives 'failed'.
    const summary = mapReconcileForJobRun({
      ...baseResult,
      repaired: 0,
      needsHumanCount: 1,
    });

    expect(summary.errorCount).toBe(1);
    expect(summary.successCount).toBe(0);
  });

  test('a clocked-in carer does not fail the run', () => {
    // `stillUnpaid` is transient: it self-heals the moment she clocks out.
    // Folding it paged once an hour for a whole overnight session. 056's
    // `cancellation_unsettled` catches the genuinely stuck version daily,
    // behind a 2-hour age gate.
    const summary = mapReconcileForJobRun({
      ...baseResult,
      repaired: 0,
      stillUnpaidCount: 3,
    });

    expect(summary.errorCount).toBe(0);
    expect(summary.stillUnpaidCount).toBe(3);
  });
});
