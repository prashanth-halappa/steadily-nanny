/**
 * S5 — the recurring shift left `pending` that nothing ever resolved.
 *
 * Cover-ask expiry excludes `recurring`, completion excludes `pending`, and
 * no-show requires `confirmed`. So a recurring shift that lost its
 * confirmation (the silent re-materialisation demotion) sat `pending` past its
 * own end forever, AND — because no-show only fires on `confirmed` — nobody
 * was told it had been missed either.
 *
 * The resolution is `cancelled` with `cancelled_by = NULL`, never `declined`.
 * 088's rule, quoted in the audit: "`declined` — LIES. It says the carer
 * answered." She did not. Same discriminator as cover-ask expiry: cancelled
 * with a null actor means nobody acted.
 *
 * @module tests/unit/jobs/shiftCompletionJob.lapse.test
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type {
  EndedConfirmedShift,
  EndedPendingShift,
} from '../../../src/jobs/shiftCompletionJob';

let runShiftCompletionJob: typeof import('../../../src/jobs/shiftCompletionJob').runShiftCompletionJob;

beforeAll(async () => {
  ({ runShiftCompletionJob } = await import(
    '../../../src/jobs/shiftCompletionJob'
  ));
});

const NOW = new Date('2026-08-17T03:40:00.000Z');
const clock = { now: () => NOW };

function pending(id: string): EndedPendingShift {
  return { id, household_id: 'h1', local_date: '2026-08-16' };
}

function writerOf(
  confirmed: EndedConfirmedShift[],
  pendingRows: EndedPendingShift[]
) {
  return {
    listEndedConfirmed: mock(async () => confirmed),
    completeByIds: mock(async (ids: string[]) => ids.map(id => ({ id }))),
    listEndedPendingRecurring: mock(async () => pendingRows),
    lapseByIds: mock(async (ids: string[]) => ids.map(id => ({ id }))),
    appendLapsedEvents: mock(async () => undefined),
  };
}

describe('runShiftCompletionJob — the recurring lapse arm', () => {
  it('cancels past pending recurring shifts and reports the count', async () => {
    const writer = writerOf([], [pending('s1'), pending('s2')]);

    const result = await runShiftCompletionJob(writer, clock);

    // No grace period: there is no clock-out to wait for on a shift nobody
    // ever accepted, so the cutoff is `now`, not `now - COMPLETION_GRACE_MS`.
    expect(writer.listEndedPendingRecurring).toHaveBeenCalledWith(
      NOW.toISOString()
    );
    expect(writer.lapseByIds).toHaveBeenCalledWith(['s1', 's2']);
    expect(result.lapsedCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  it('appends one unconfirmed_shift_lapsed row per shift, with no actor', async () => {
    const writer = writerOf([], [pending('s1')]);

    await runShiftCompletionJob(writer, clock);

    expect(writer.appendLapsedEvents).toHaveBeenCalledWith([
      {
        household_id: 'h1',
        shift_id: 's1',
        local_date: '2026-08-16',
        // NULL, deliberately: nobody acted. Same discriminator cover-ask
        // expiry uses on `cancelled_by`.
        actor_id: null,
        event_type: 'unconfirmed_shift_lapsed',
        payload: { key: 's1' },
      },
    ]);
  });

  it('asks the DB nothing when there is nothing to lapse', async () => {
    const writer = writerOf([], []);

    const result = await runShiftCompletionJob(writer, clock);

    expect(writer.lapseByIds).not.toHaveBeenCalled();
    expect(writer.appendLapsedEvents).not.toHaveBeenCalled();
    expect(result.lapsedCount).toBe(0);
  });

  it('only counts the rows the CAS actually won', async () => {
    const writer = writerOf([], [pending('s1'), pending('s2')]);
    writer.lapseByIds = mock(async () => [{ id: 's1' }]);

    const result = await runShiftCompletionJob(writer, clock);

    expect(result.lapsedCount).toBe(1);
  });

  it('still completes worked shifts when the lapse arm blows up', async () => {
    const writer = writerOf([{ id: 'w1', worked: true }], [pending('s1')]);
    writer.lapseByIds = mock(async () => {
      throw new Error('supabase is down');
    });

    const result = await runShiftCompletionJob(writer, clock);

    expect(result.completedCount).toBe(1);
    expect(result.lapsedCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });
});
