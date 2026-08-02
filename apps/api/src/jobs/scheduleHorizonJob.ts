/**
 * Schedule-horizon-rolling job.
 *
 * `schedulePatternCommandService.respond`'s accept branch materialises a
 * pattern out to `DEFAULT_MATERIALISATION_HORIZON_DAYS` (84 days / 12
 * weeks) exactly ONCE, the instant the carer accepts. Nothing else advances
 * that window afterwards — so left alone, an accepted pattern quietly stops
 * producing new shifts the day its original 84-day horizon passes, even
 * though the pattern itself never changed. This job re-runs the SAME
 * materialisation (`schedulePatternCommandService.materialiseForHorizon`,
 * extracted from `respond`'s private `materialiseAccepted` so both call
 * sites share one implementation) for every currently-accepted pattern, so
 * the horizon keeps rolling forward on a schedule instead of freezing.
 *
 * Also sweeps past-due `co_parent_approvals` across every household (flow 1f
 * — see `supabase/migrations/022_co_parent_approvals.sql`). Timing out means
 * auto-approve-by-silence, so each expired row's parked mutation is re-driven
 * through `approvalApplierRegistry`. A failure there is logged and swallowed
 * rather than failing the whole job: rolling the schedule horizon is this
 * job's real purpose and must not depend on the approval sweep succeeding.
 *
 * SETUP: wire this into `/api/jobs/schedule-horizon` — see
 * `controllers/jobController.ts` and `routes/jobRoutes.ts`, following the
 * `example-maintenance` job's own wiring — and schedule it daily via
 * pg_cron (see migration 007's commented-out example).
 *
 * @module jobs/scheduleHorizonJob
 */

import {
  type CoParentApprovalQueryService,
  coParentApprovalQueryService,
} from '../domains/household/services/coParentApprovalQueryService';
import { SchedulePatternRepository } from '../domains/schedule/repositories/schedulePatternRepository';
import {
  type SchedulePatternCommandService,
  schedulePatternCommandService,
} from '../domains/schedule/services/schedulePatternCommandService';
import type { SchedulePattern } from '../domains/schedule/types';
import { logger } from '../middlewares/logger';

export interface ScheduleHorizonJobResult {
  patternsProcessed: number;
  successCount: number;
  errorCount: number;
  coParentApprovalsExpired: number;
  message: string;
}

/** The narrow repository contract this job depends on, for injecting a fake in tests. */
export interface AcceptedPatternRepository {
  listAccepted(): Promise<SchedulePattern[]>;
}

/** The narrow command-service contract this job depends on, for injecting a fake in tests. */
export type HorizonMaterialisationService = Pick<
  SchedulePatternCommandService,
  'materialiseForHorizon'
>;

/** The narrow approval-expiry contract this job depends on, for injecting a fake in tests. */
export type HorizonApprovalExpiryService = Pick<
  CoParentApprovalQueryService,
  'expirePendingApprovals'
>;

export async function runScheduleHorizonJob(
  patternRepo: AcceptedPatternRepository = new SchedulePatternRepository(),
  commandService: HorizonMaterialisationService = schedulePatternCommandService,
  approvals: HorizonApprovalExpiryService = coParentApprovalQueryService
): Promise<ScheduleHorizonJobResult> {
  const patterns = await patternRepo.listAccepted();

  let successCount = 0;
  let errorCount = 0;

  for (const pattern of patterns) {
    try {
      await commandService.materialiseForHorizon(pattern);
      successCount++;
    } catch (error) {
      errorCount++;
      logger.error('Schedule horizon job failed to materialise a pattern', {
        patternId: pattern.id,
        error,
      });
    }
  }

  const coParentApprovalsExpired =
    await expireStaleCoParentApprovals(approvals);

  return {
    patternsProcessed: patterns.length,
    successCount,
    errorCount,
    coParentApprovalsExpired,
    message: `Rolled the materialisation horizon forward for ${successCount}/${patterns.length} accepted schedule pattern(s)`,
  };
}

/**
 * Sweep every household's past-due `co_parent_approvals` (flow 1f). Called
 * with no `householdId`, so it is global — otherwise timeouts would only ever
 * fire for a household whose parent happens to OPEN the approvals screen, and
 * a family where nobody looks would never resolve a pending change at all.
 *
 * Expiry is auto-approve-by-silence: `expirePendingApprovals` re-drives each
 * expired row's gated mutation through `approvalApplierRegistry`, and logs and
 * steps over any row it cannot apply. A hard failure here is logged and
 * swallowed rather than failing the schedule-horizon work above, which is this
 * job's real purpose.
 */
async function expireStaleCoParentApprovals(
  approvals: HorizonApprovalExpiryService
): Promise<number> {
  try {
    const expired = await approvals.expirePendingApprovals();
    return expired.length;
  } catch (error) {
    logger.error('Schedule horizon job: co_parent_approvals expiry failed', {
      error,
    });
    return 0;
  }
}
