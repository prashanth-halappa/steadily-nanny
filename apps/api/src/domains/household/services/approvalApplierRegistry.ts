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
import type { CoParentApproval, CoParentApprovalAction } from '../types';

/**
 * Re-drives the mutation described by `approval.payload`. Throwing is
 * meaningful: it means the mutation could NOT be applied (the shift was
 * deleted, times became invalid, …) and the caller decides whether that
 * surfaces to the user or is logged and stepped over.
 */
export type ApprovalApplier = (approval: CoParentApproval) => Promise<void>;

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
   * Run the applier for this approval's action. Returns false when no domain
   * has registered one — a real wiring gap, so it is logged loudly rather than
   * passing silently (the original flow-1f defect was exactly this: an
   * approval that flipped to `approved` and then did nothing at all).
   */
  async apply(approval: CoParentApproval): Promise<boolean> {
    const applier = this.appliers.get(approval.action);
    if (!applier) {
      logger.error('No approval applier registered for action', {
        action: approval.action,
        approvalId: approval.id,
        householdId: approval.household_id,
      });
      return false;
    }
    await applier(approval);
    return true;
  }

  /**
   * Batch variant for the timeout sweep: one bad row must never stop the rest
   * of the batch, so failures are logged and stepped over. Returns the number
   * successfully applied.
   */
  async applyAllSettled(approvals: CoParentApproval[]): Promise<number> {
    let applied = 0;
    for (const approval of approvals) {
      try {
        if (await this.apply(approval)) {
          applied++;
        }
      } catch (error) {
        logger.error('Failed to apply timed-out co-parent approval', {
          action: approval.action,
          approvalId: approval.id,
          error,
          householdId: approval.household_id,
        });
      }
    }
    return applied;
  }
}

// Singleton — the registry IS process-global wiring, not per-request state.
export const approvalApplierRegistry = new ApprovalApplierRegistry();
