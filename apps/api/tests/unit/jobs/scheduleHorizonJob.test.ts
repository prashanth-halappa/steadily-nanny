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

/** A change-request repository that finds nothing stale. */
function noChangeRequests() {
  return { expirePendingOlderThan: mock(async (_cutoffIso: string) => []) };
}

/** A no-op materialiser, for the tests that only care about the sweeps. */
function noOpMaterialiser() {
  return {
    materialiseForHorizon: mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    })),
  };
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
      noApprovals(),
      noChangeRequests()
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
      noApprovals(),
      noChangeRequests()
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
      noApprovals(),
      noChangeRequests()
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

    await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noApprovals(),
      noChangeRequests()
    );

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
      approvals,
      noChangeRequests()
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
      approvals,
      noChangeRequests()
    );

    expect(result.successCount).toBe(1);
    expect(result.coParentApprovalsExpired).toBe(0);
  });
});

describe('runScheduleHorizonJob — stale change-request sweep (F-B5-5)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('expires pending change requests older than 7 days and reports how many', async () => {
    const patternRepo = { listAccepted: mock(async () => []) };
    const changeRequests = {
      expirePendingOlderThan: mock(async (_cutoffIso: string) => [
        { id: 'cr1' },
        { id: 'cr2' },
        { id: 'cr3' },
      ]) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const before = Date.now();
    const result = await runScheduleHorizonJob(
      patternRepo,
      noOpMaterialiser(),
      noApprovals(),
      changeRequests
    );
    const after = Date.now();

    expect(changeRequests.expirePendingOlderThan).toHaveBeenCalledTimes(1);
    const [firstCall] = changeRequests.expirePendingOlderThan.mock.calls;
    // `?? ''` parses to NaN, which fails both bounds below — so a missing
    // call can never pass this test by accident.
    const cutoff = Date.parse(firstCall?.[0] ?? '');
    // Compared as instants, not strings: the cutoff is 7 days back from
    // whenever the run started, so it can only land inside this window.
    expect(cutoff).toBeGreaterThanOrEqual(before - 7 * DAY_MS);
    expect(cutoff).toBeLessThanOrEqual(after - 7 * DAY_MS);
    expect(result.changeRequestsExpired).toBe(3);
  });

  it('sweeps globally — no household argument', async () => {
    // Same reasoning as the approvals sweep above: scoping to one household
    // means a request only ages out for a family that happens to open the
    // screen, and the families who stopped looking are exactly the ones with
    // rotting pending rows.
    const patternRepo = { listAccepted: mock(async () => []) };
    const changeRequests = noChangeRequests();

    await runScheduleHorizonJob(
      patternRepo,
      noOpMaterialiser(),
      noApprovals(),
      changeRequests
    );

    expect(changeRequests.expirePendingOlderThan.mock.calls[0]).toHaveLength(1);
  });

  it('reports 0 and still completes the horizon work when the sweep throws', async () => {
    const patternRepo = { listAccepted: mock(async () => [patternFor()]) };
    const materialiseForHorizon = mock(async () => ({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    }));
    const changeRequests = {
      expirePendingOlderThan: mock(async () => {
        throw new Error('shift_change_requests unreachable');
      }) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const result = await runScheduleHorizonJob(
      patternRepo,
      { materialiseForHorizon },
      noApprovals(),
      changeRequests
    );

    expect(result.successCount).toBe(1);
    expect(result.changeRequestsExpired).toBe(0);
  });

  it('still sweeps change requests when the approvals sweep throws', async () => {
    // The two sweeps are isolated from each other, not just from the horizon
    // work. One unreachable table must not silently stop the other sweep.
    const patternRepo = { listAccepted: mock(async () => []) };
    const approvals = {
      expirePendingApprovals: mock(async () => {
        throw new Error('approvals table unreachable');
      }) as unknown as ReturnType<typeof noApprovals>['expirePendingApprovals'],
    };
    const changeRequests = {
      expirePendingOlderThan: mock(async (_cutoffIso: string) => [
        { id: 'cr1' },
      ]) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const result = await runScheduleHorizonJob(
      patternRepo,
      noOpMaterialiser(),
      approvals,
      changeRequests
    );

    expect(result.coParentApprovalsExpired).toBe(0);
    expect(result.changeRequestsExpired).toBe(1);
  });
});
