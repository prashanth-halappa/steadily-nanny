/**
 * TDD tests for the schedule-horizon-rolling job. `patternRepo` and
 * `commandService` are both injected (see `runScheduleHorizonJob`'s own
 * signature) so these never touch Supabase.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { SchedulePattern } from '../../../src/domains/schedule/types';
import { runScheduleHorizonJob } from '../../../src/jobs/scheduleHorizonJob';

function patternFor(overrides: Partial<SchedulePattern> = {}): SchedulePattern {
  return {
    id: 'p1',
    household_id: 'h1',
    carer_id: 'carer-1',
    status: 'accepted',
    rrule: 'FREQ=WEEKLY;INTERVAL=1',
    dtstart: '2026-02-02',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_by: 'u1',
    sent_at: null,
    responded_at: null,
    ical_uid: 'pattern-uid',
    sequence: 0,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

/** An approval-expiry service that finds nothing past due. */
function noApprovals() {
  return { expirePendingApprovals: mock(async () => []) };
}

describe('runScheduleHorizonJob', () => {
  it('materialises every accepted pattern the repository lists', async () => {
    const patterns = [patternFor({ id: 'p1' }), patternFor({ id: 'p2' })];
    const patternRepo = { listAccepted: mock(async () => patterns) };
    const materialiseForHorizon = mock(async () => ({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    }));
    const commandService = { materialiseForHorizon };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noApprovals()
    );

    expect(materialiseForHorizon).toHaveBeenCalledTimes(2);
    expect(materialiseForHorizon).toHaveBeenCalledWith(patterns[0]);
    expect(materialiseForHorizon).toHaveBeenCalledWith(patterns[1]);
    expect(result.patternsProcessed).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  it('does nothing when there are no accepted patterns', async () => {
    const patternRepo = { listAccepted: mock(async () => []) };
    const materialiseForHorizon = mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    }));
    const commandService = { materialiseForHorizon };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noApprovals()
    );

    expect(materialiseForHorizon).not.toHaveBeenCalled();
    expect(result.patternsProcessed).toBe(0);
    expect(result.successCount).toBe(0);
  });

  it('keeps processing remaining patterns when one materialise call fails, and reports the error count', async () => {
    const patterns = [
      patternFor({ id: 'p-good-1' }),
      patternFor({ id: 'p-bad' }),
      patternFor({ id: 'p-good-2' }),
    ];
    const patternRepo = { listAccepted: mock(async () => patterns) };
    const materialiseForHorizon = mock(async (pattern: SchedulePattern) => {
      if (pattern.id === 'p-bad') {
        throw new Error('boom');
      }
      return {
        created: 1,
        updated: 0,
        deleted: 0,
        cancelled: 0,
        conflicts: [],
      };
    });
    const commandService = { materialiseForHorizon };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noApprovals()
    );

    expect(materialiseForHorizon).toHaveBeenCalledTimes(3);
    expect(result.patternsProcessed).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(1);
  });

  it("never touches draft/pending/declined/withdrawn patterns — only whatever the repository's listAccepted returns", async () => {
    // The job trusts `listAccepted()` entirely; it applies no status filter
    // of its own. This test pins that contract so a future refactor can't
    // silently start re-filtering (or stop filtering) inside the job.
    const patternRepo = { listAccepted: mock(async () => [patternFor()]) };
    const materialiseForHorizon = mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    }));
    const commandService = { materialiseForHorizon };

    await runScheduleHorizonJob(patternRepo, commandService, noApprovals());

    expect(patternRepo.listAccepted).toHaveBeenCalledTimes(1);
    expect(patternRepo.listAccepted).toHaveBeenCalledWith();
  });

  it('sweeps co_parent_approvals globally — no householdId — and reports how many expired', async () => {
    // Global on purpose: scoping the sweep to one household would mean a
    // pending approval only ever times out for a family whose parent happens
    // to open the approvals screen.
    const patternRepo = { listAccepted: mock(async () => []) };
    const materialiseForHorizon = mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    }));
    const commandService = { materialiseForHorizon };
    const approvals = {
      expirePendingApprovals: mock(async () => [
        { id: 'a1' },
        { id: 'a2' },
      ]) as unknown as ReturnType<typeof noApprovals>['expirePendingApprovals'],
    };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      approvals
    );

    expect(approvals.expirePendingApprovals).toHaveBeenCalledWith();
    expect(result.coParentApprovalsExpired).toBe(2);
  });

  it('still completes the horizon work when co_parent_approvals expiry throws', async () => {
    const patternRepo = { listAccepted: mock(async () => [patternFor()]) };
    const materialiseForHorizon = mock(async () => ({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    }));
    const commandService = { materialiseForHorizon };
    const approvals = {
      expirePendingApprovals: mock(async () => {
        throw new Error('approvals table unreachable');
      }) as unknown as ReturnType<typeof noApprovals>['expirePendingApprovals'],
    };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      approvals
    );

    expect(result.successCount).toBe(1);
    expect(result.coParentApprovalsExpired).toBe(0);
  });
});
