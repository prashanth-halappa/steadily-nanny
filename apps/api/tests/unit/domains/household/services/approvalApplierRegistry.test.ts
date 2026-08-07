import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CoParentApproval } from '../../../../../src/domains/household/types';

// `approvalApplierRegistry` now pushes to the requester on the sweep's
// terminal-failure and successful-timeout-apply paths (D3/D4), so
// `notifyUser` must be mocked BEFORE the dynamic import below — see
// docs/09-TESTING.md's mock.module boilerplate.
let approvalApplierRegistry: typeof import('../../../../../src/domains/household/services/approvalApplierRegistry').approvalApplierRegistry;
let notifyUser: ReturnType<typeof mock>;

beforeAll(async () => {
  notifyUser = mock(() => undefined);
  mock.module('../../../../../src/domains/notification', () => ({
    notifyUser,
    notifyHouseholdParents: mock(() => undefined),
  }));

  ({ approvalApplierRegistry } = await import(
    '../../../../../src/domains/household/services/approvalApplierRegistry'
  ));
});

beforeEach(() => {
  notifyUser.mockClear();
});

function timedOut(overrides: Partial<CoParentApproval> = {}): CoParentApproval {
  return {
    id: 'a1',
    household_id: 'h1',
    requested_by: 'u2',
    action: 'cancel',
    payload: {},
    status: 'timed_out',
    timeout_at: '2000-01-01T00:00:00Z',
    responded_by: null,
    responded_at: 't',
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

function makeClaimRepo(overrides: Record<string, unknown> = {}) {
  return {
    recordFailedApply: mock(async () => 'retrying' as const),
    clearApplyMarkers: mock(async () => {}),
    ...overrides,
  };
}

describe('ApprovalApplierRegistry.applyAllSettled', () => {
  it('records a failed apply against the row it already timed out, and steps over it', async () => {
    // The sweep commits `timed_out` before the applier runs. A logged-and
    // -dropped failure leaves a terminally timed-out approval with nothing
    // applied and no way back.
    const applied: string[] = [];
    approvalApplierRegistry.register('cancel', async approval => {
      if (approval.id === 'a-bad') throw new Error('shift already started');
      applied.push(approval.id);
    });
    const repo = makeClaimRepo();

    const count = await approvalApplierRegistry.applyAllSettled(
      [timedOut({ id: 'a-bad' }), timedOut({ id: 'a-good' })],
      repo
    );

    expect(applied).toEqual(['a-good']);
    expect(count).toBe(1);
    expect(repo.recordFailedApply).toHaveBeenCalledTimes(1);
    expect(repo.recordFailedApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a-bad' }),
      'timed_out',
      'shift already started',
      // A real applier failure MAY have half-written, so it spends an attempt.
      true
    );
  });

  it('records nothing when every applier succeeds — the uncontested path costs nothing', async () => {
    approvalApplierRegistry.register('cancel', async () => {});
    const repo = makeClaimRepo();

    const count = await approvalApplierRegistry.applyAllSettled(
      [timedOut({ id: 'a1' }), timedOut({ id: 'a2' })],
      repo
    );

    expect(count).toBe(2);
    expect(repo.recordFailedApply).not.toHaveBeenCalled();
  });

  it('treats an action with NO registered applier as a failed apply that costs no attempt', async () => {
    // `other` has no applier registered by any domain. It used to settle
    // terminally with the payload never applied — the exact original defect.
    // But a missing applier writes NOTHING, so there is no partial state to
    // protect against, and spending attempts would turn a registration bug
    // into permanently withdrawn mutations two taps later. It waits for a
    // deploy instead.
    const repo = makeClaimRepo();

    const count = await approvalApplierRegistry.applyAllSettled(
      [timedOut({ id: 'a-orphan', action: 'other' })],
      repo
    );

    expect(count).toBe(0);
    expect(repo.recordFailedApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a-orphan' }),
      'timed_out',
      expect.any(String),
      false
    );
  });

  it('clears stale apply markers once a row finally applies', async () => {
    approvalApplierRegistry.register('cancel', async () => {});
    const repo = makeClaimRepo();

    await approvalApplierRegistry.applyAllSettled(
      [timedOut({ id: 'a1' })],
      repo
    );

    expect(repo.clearApplyMarkers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    );
  });

  it('keeps sweeping when recording the failure itself fails', async () => {
    approvalApplierRegistry.register('cancel', async approval => {
      if (approval.id === 'a-bad') throw new Error('shift already started');
    });
    const repo = makeClaimRepo({
      recordFailedApply: mock(async () => {
        throw new Error('database unreachable');
      }),
    });

    const count = await approvalApplierRegistry.applyAllSettled(
      [timedOut({ id: 'a-bad' }), timedOut({ id: 'a-good' })],
      repo
    );

    expect(count).toBe(1);
  });

  describe('D3 — a terminally-failed timeout apply must not vanish silently', () => {
    it('notifies the requester once the row is exhausted (terminal `failed`)', async () => {
      approvalApplierRegistry.register('cancel', async () => {
        throw new Error('shift already started');
      });
      const repo = makeClaimRepo({
        recordFailedApply: mock(async () => 'failed' as const),
      });

      await approvalApplierRegistry.applyAllSettled(
        [timedOut({ id: 'a-bad', requested_by: 'u2' })],
        repo
      );

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'u2',
        expect.objectContaining({
          body: expect.stringMatching(/couldn.t be completed/i),
        })
      );
    });

    it('does NOT notify the requester on a first, still-retrying failure', async () => {
      approvalApplierRegistry.register('cancel', async () => {
        throw new Error('shift already started');
      });
      const repo = makeClaimRepo({
        recordFailedApply: mock(async () => 'retrying' as const),
      });

      await approvalApplierRegistry.applyAllSettled(
        [timedOut({ id: 'a-bad' })],
        repo
      );

      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('does NOT notify when the row was missed (moved on to a concurrent sweep/respond)', async () => {
      approvalApplierRegistry.register('cancel', async () => {
        throw new Error('shift already started');
      });
      const repo = makeClaimRepo({
        recordFailedApply: mock(async () => 'missed' as const),
      });

      await approvalApplierRegistry.applyAllSettled(
        [timedOut({ id: 'a-bad' })],
        repo
      );

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });

  describe('D4 — a timeout auto-approval must resolve for the requester, not just apply silently', () => {
    it('notifies the requester when a timed-out row applies successfully', async () => {
      approvalApplierRegistry.register('cancel', async () => {});
      const repo = makeClaimRepo();

      await approvalApplierRegistry.applyAllSettled(
        [timedOut({ id: 'a1', requested_by: 'u2' })],
        repo
      );

      expect(notifyUser).toHaveBeenCalledTimes(1);
      expect(notifyUser).toHaveBeenCalledWith(
        'u2',
        expect.objectContaining({
          title: expect.stringContaining('approved'),
        })
      );
    });

    it('does NOT send a resolved notification when the applier fails (D3 handles the terminal case)', async () => {
      approvalApplierRegistry.register('cancel', async () => {
        throw new Error('shift already started');
      });
      const repo = makeClaimRepo({
        recordFailedApply: mock(async () => 'retrying' as const),
      });

      await approvalApplierRegistry.applyAllSettled(
        [timedOut({ id: 'a-bad' })],
        repo
      );

      expect(notifyUser).not.toHaveBeenCalled();
    });
  });
});
