/**
 * S2 / D-24 — the writer `completed` never had.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { EndedConfirmedShift } from '../../../src/jobs/shiftCompletionJob';

let runShiftCompletionJob: typeof import('../../../src/jobs/shiftCompletionJob').runShiftCompletionJob;
let COMPLETION_GRACE_MS: number;

beforeAll(async () => {
  const mod = await import('../../../src/jobs/shiftCompletionJob');
  runShiftCompletionJob = mod.runShiftCompletionJob;
  COMPLETION_GRACE_MS = mod.COMPLETION_GRACE_MS;
});

const NOW = new Date();
const clock = { now: () => NOW };

function worked(id: string): EndedConfirmedShift {
  return { id, worked: true };
}
function unworked(id: string): EndedConfirmedShift {
  return { id, worked: false };
}

function writerOf(rows: EndedConfirmedShift[]) {
  return {
    listEndedConfirmed: mock(async (_cutoff: string) => rows),
    completeByIds: mock(async (ids: string[]) => ids.map(id => ({ id }))),
    // S5's second arm — inert here; its own matrix is in
    // shiftCompletionJob.lapse.test.ts.
    listEndedPendingRecurring: mock(async (_cutoff: string) => []),
    lapseByIds: mock(async (ids: string[]) => ids.map(id => ({ id }))),
    appendLapsedEvents: mock(async () => undefined),
  };
}

describe('runShiftCompletionJob', () => {
  it('completes past confirmed shifts and reports the count', async () => {
    const writer = writerOf([worked('s1'), worked('s2')]);

    const result = await runShiftCompletionJob(writer, clock);

    expect(writer.listEndedConfirmed).toHaveBeenCalledTimes(1);
    expect(result.completedCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  it('NEVER completes a shift with no hours behind it — a no-show is not work', async () => {
    // `noShowJob` never changes `shifts.status`, so a shift the carer no-showed
    // is still `confirmed` at 03:40. Completing it would put a worked-looking,
    // IMMUTABLE row in the record for a morning nobody turned up to.
    const writer = writerOf([worked('s1'), unworked('no-show')]);

    const result = await runShiftCompletionJob(writer, clock);

    expect(writer.completeByIds).toHaveBeenCalledWith(['s1']);
    expect(result.completedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('does not write at all when every candidate is unworked', async () => {
    const writer = writerOf([unworked('no-show')]);

    const result = await runShiftCompletionJob(writer, clock);

    expect(writer.completeByIds).not.toHaveBeenCalled();
    expect(result.completedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it('leaves a grace period past ends_at rather than gating on local midnight', async () => {
    // A grace period is what lets ONE nightly UTC tick be correct in every
    // timezone — unlike the digests, which have household-local send windows.
    const writer = writerOf([]);
    await runShiftCompletionJob(writer, clock);

    const [cutoff] = writer.listEndedConfirmed.mock.calls[0] ?? [];
    expect(Date.parse(String(cutoff))).toBe(
      NOW.getTime() - COMPLETION_GRACE_MS
    );
  });

  it('ONE write whatever the row count — batched, never a per-row loop (#28)', async () => {
    const writer = writerOf(
      Array.from({ length: 5000 }, (_, i) => worked(`s${i}`))
    );

    const result = await runShiftCompletionJob(writer, clock);

    expect(writer.listEndedConfirmed).toHaveBeenCalledTimes(1);
    expect(writer.completeByIds).toHaveBeenCalledTimes(1);
    expect(result.completedCount).toBe(5000);
  });

  it('a failure is reported, never thrown — a cron that 500s pages someone about bookkeeping', async () => {
    const result = await runShiftCompletionJob(
      {
        ...writerOf([]),
        listEndedConfirmed: mock(async () => {
          throw new Error('db down');
        }),
      },
      clock
    );

    expect(result.completedCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });
});
