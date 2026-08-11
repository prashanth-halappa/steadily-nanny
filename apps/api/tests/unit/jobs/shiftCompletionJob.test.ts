/**
 * S2 / D-24 — the writer `completed` never had.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

let runShiftCompletionJob: typeof import('../../../src/jobs/shiftCompletionJob').runShiftCompletionJob;
let COMPLETION_GRACE_MS: number;

beforeAll(async () => {
  const mod = await import('../../../src/jobs/shiftCompletionJob');
  runShiftCompletionJob = mod.runShiftCompletionJob;
  COMPLETION_GRACE_MS = mod.COMPLETION_GRACE_MS;
});

const NOW = new Date('2026-08-11T03:40:00.000Z');
const clock = { now: () => NOW };

describe('runShiftCompletionJob', () => {
  it('completes past confirmed shifts and reports the count', async () => {
    const completeEndedBefore = mock(async (_cutoff: string) => [
      { id: 's1' },
      { id: 's2' },
    ]);

    const result = await runShiftCompletionJob({ completeEndedBefore }, clock);

    expect(completeEndedBefore).toHaveBeenCalledTimes(1);
    expect(result.completedCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  it('leaves a grace period past ends_at rather than gating on local midnight', async () => {
    // A grace period is what lets ONE nightly UTC tick be correct in every
    // timezone — unlike the digests, which have household-local send windows.
    const completeEndedBefore = mock(async (_cutoff: string) => []);
    await runShiftCompletionJob({ completeEndedBefore }, clock);

    const [cutoff] = completeEndedBefore.mock.calls[0] ?? [];
    expect(Date.parse(String(cutoff))).toBe(
      NOW.getTime() - COMPLETION_GRACE_MS
    );
  });

  it('ONE call whatever the row count — batched, never a per-row loop (#28)', async () => {
    const completeEndedBefore = mock(async (_cutoff: string) =>
      Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}` }))
    );

    const result = await runShiftCompletionJob({ completeEndedBefore }, clock);

    expect(completeEndedBefore).toHaveBeenCalledTimes(1);
    expect(result.completedCount).toBe(5000);
  });

  it('a failure is reported, never thrown — a cron that 500s pages someone about bookkeeping', async () => {
    const result = await runShiftCompletionJob(
      {
        completeEndedBefore: mock(async () => {
          throw new Error('db down');
        }),
      },
      clock
    );

    expect(result.completedCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });
});
