/**
 * Approval applier registry — the seam that lets an approved (or
 * auto-approved-by-silence) `co_parent_approvals` row actually DRIVE the
 * mutation it was gating.
 *
 * `approvalGateService` deliberately stores the pending mutation as an opaque
 * `payload` and returns `needsApproval` so the calling domain does NOT apply
 * it. Something has to pick that payload back up once the other parent says
 * yes — but the household domain cannot import the shift/schedule domains to
 * do it, because those already import household (`approvalGateService`,
 * `assertHouseholdWriteRole`, …) and a static back-edge would be an import
 * cycle.
 *
 * So the owning domain registers an applier for the actions it originated, and
 * the approval command/query services resolve through this registry. Registration
 * happens at module load of the owning domain's command service, which
 * `routes/index.ts` imports at boot — so every applier is in place before the
 * first request is served.
 *
 * @module domains/household/services/approvalApplierRegistry
 */
import { logger } from '../../../middlewares/logger';
import { CoParentApprovalRepository } from '../repositories/coParentApprovalRepository';
import { CO_PARENT_APPROVAL_STATUSES } from '../schemas';
import type { CoParentApproval, CoParentApprovalAction } from '../types';

/**
 * Re-drives the mutation described by `approval.payload`. Throwing is
 * meaningful: it means the mutation could NOT be applied (the shift was
 * deleted, times became invalid, …) and the caller decides whether that
 * surfaces to the user or is logged and stepped over.
 */
export type ApprovalApplier = (approval: CoParentApproval) => Promise<void>;

/**
 * Nothing ran, so nothing could have half-written. Callers use this to decide
 * that the failure costs no attempt — a registration bug must not settle a
 * user's parked mutation as terminally `withdrawn`.
 */
export class NoApplierRegisteredError extends Error {
  constructor(action: CoParentApprovalAction) {
    super(`No approval applier registered for action ${action}`);
    this.name = 'NoApplierRegisteredError';
  }
}

/** The narrow repository contract `applyAllSettled` needs, for injecting a fake in tests. */
export interface ApprovalClaimRepository {
  recordFailedApply(
    approval: Pick<CoParentApproval, 'id' | 'payload'>,
    fromStatus: 'approved' | 'timed_out',
    reason: string,
    countsAttempt?: boolean
  ): Promise<'retrying' | 'failed' | 'missed'>;
  clearApplyMarkers(
    approval: Pick<CoParentApproval, 'id' | 'payload'>
  ): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failure that wrote nothing can be retried for free; a partial write cannot. */
export function failureCostsAttempt(error: unknown): boolean {
  return !(error instanceof NoApplierRegisteredError);
}

class ApprovalApplierRegistry {
  private readonly appliers = new Map<
    CoParentApprovalAction,
    ApprovalApplier
  >();

  /** Called once, at module load of the domain that originates `action`. */
  register(action: CoParentApprovalAction, applier: ApprovalApplier): void {
    this.appliers.set(action, applier);
  }

  /**
   * Run the applier for this approval's action. A missing applier THROWS like
   * any other failed apply, so both callers route it through the same
   * failure handling — returning quietly was the original flow-1f defect
   * itself: an approval that flipped to `approved` and then did nothing at all.
   */
  async apply(approval: CoParentApproval): Promise<void> {
    const applier = this.appliers.get(approval.action);
    if (!applier) {
      logger.error('No approval applier registered for action', {
        action: approval.action,
        approvalId: approval.id,
        householdId: approval.household_id,
      });
      throw new NoApplierRegisteredError(approval.action);
    }
    await applier(approval);
  }

  /**
   * Batch variant for the timeout sweep: one bad row must never stop the rest
   * of the batch, so failures are logged and stepped over. Returns the number
   * successfully applied.
   *
   * The caller has ALREADY committed `timed_out` on these rows, so stepping
   * over a failure used to mean a terminal row with nothing applied and no way
   * back. Each failure is therefore recorded against its own row, which either
   * hands it back as `pending` for one retry or settles it terminally — see
   * `coParentApprovalRepository.recordFailedApply` for why that is bounded.
   */
  async applyAllSettled(
    approvals: CoParentApproval[],
    approvalRepo: ApprovalClaimRepository = new CoParentApprovalRepository()
  ): Promise<number> {
    let applied = 0;
    for (const approval of approvals) {
      try {
        await this.apply(approval);
        applied++;
        await this.clearMarkers(approval, approvalRepo);
      } catch (error) {
        logger.error('Failed to apply timed-out co-parent approval', {
          action: approval.action,
          approvalId: approval.id,
          error,
          householdId: approval.household_id,
        });
        await this.recordFailure(approval, error, approvalRepo);
      }
    }
    return applied;
  }

  /** Best-effort; a failed record must not stop the rest of the sweep. */
  private async recordFailure(
    approval: CoParentApproval,
    cause: unknown,
    approvalRepo: ApprovalClaimRepository
  ): Promise<void> {
    const reason = errorMessage(cause);
    try {
      const outcome = await approvalRepo.recordFailedApply(
        approval,
        CO_PARENT_APPROVAL_STATUSES.TIMED_OUT,
        reason,
        failureCostsAttempt(cause)
      );
      if (outcome === 'failed') {
        logger.error(
          'Gave up applying a timed-out co-parent approval; it is now withdrawn',
          {
            approvalId: approval.id,
            householdId: approval.household_id,
            reason,
          }
        );
      }
      if (outcome === 'missed') {
        logger.warn(
          'Could not record a failed co-parent approval apply; the row had already moved on',
          { approvalId: approval.id, householdId: approval.household_id }
        );
      }
    } catch (error) {
      logger.error('Failed to record a failed co-parent approval apply', {
        approvalId: approval.id,
        error,
      });
    }
  }

  /** Best-effort; a stale marker is not worth failing a successful sweep over. */
  private async clearMarkers(
    approval: CoParentApproval,
    approvalRepo: ApprovalClaimRepository
  ): Promise<void> {
    try {
      await approvalRepo.clearApplyMarkers(approval);
    } catch (error) {
      logger.error('Failed to clear co-parent approval apply markers', {
        approvalId: approval.id,
        error,
      });
    }
  }
}

// Singleton — the registry IS process-global wiring, not per-request state.
export const approvalApplierRegistry = new ApprovalApplierRegistry();
