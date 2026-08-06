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
 * through `approvalApplierRegistry`. A row whose applier fails is put BACK to
 * `pending` by the registry so the next sweep retries it — it never settles as
 * `timed_out` with nothing applied. A hard failure of the sweep itself is
 * logged and swallowed rather than failing the whole job: rolling the schedule
 * horizon is this job's real purpose and must not depend on the approval sweep
 * succeeding.
 *
 * And ages out `shift_change_requests` nobody answered (F-B5-5, migration
 * 064). That table had five statuses and no clock — four reached by somebody
 * DOING something, none by nobody doing anything — so an unanswered request
 * stayed `pending` long after the shift it was about. `EXPIRY_DAYS` days after
 * `created_at` the sweep flips it to `expired`, which is deliberately not
 * `withdrawn`: withdrawn means the requester acted. Same logged-and-swallowed
 * isolation as the approval sweep, and isolated from that sweep too — one
 * unreachable table is not a reason to skip the other.
 *
 * SETUP: scheduled daily via pg_cron in migration
 * `026_schedule_horizon_cron.sql` (POST `/api/jobs/schedule-horizon`). Requires
 * Vault secrets `cron_api_base_url` and `cron_job_api_key` (see migration 007).
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
import { ShiftChangeRequestRepository } from '../domains/shift/repositories/shiftChangeRequestRepository';
import { logger } from '../middlewares/logger';

/**
 * How long a change request may sit unanswered before the sweep calls it
 * `expired` (F-B5-5, migration 064).
 *
 * ponytail: a product default picked during the audit closeout, not a derived
 * constant — the owner can tune it here without a migration. Per-household
 * configuration is the upgrade path if families ever disagree about it, and
 * `households.short_notice_hours` is the precedent for how that would look.
 */
const EXPIRY_DAYS = 7;

export interface ScheduleHorizonJobResult {
  patternsProcessed: number;
  successCount: number;
  errorCount: number;
  coParentApprovalsExpired: number;
  changeRequestsExpired: number;
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

/** The narrow change-request-expiry contract this job depends on, for injecting a fake in tests. */
export type HorizonChangeRequestExpiryRepository = Pick<
  ShiftChangeRequestRepository,
  'expirePendingOlderThan'
>;

export async function runScheduleHorizonJob(
  patternRepo: AcceptedPatternRepository = new SchedulePatternRepository(),
  commandService: HorizonMaterialisationService = schedulePatternCommandService,
  approvals: HorizonApprovalExpiryService = coParentApprovalQueryService,
  changeRequests: HorizonChangeRequestExpiryRepository = new ShiftChangeRequestRepository()
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
  const changeRequestsExpired = await expireStaleChangeRequests(changeRequests);

  return {
    patternsProcessed: patterns.length,
    successCount,
    errorCount,
    coParentApprovalsExpired,
    changeRequestsExpired,
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
 * expired row's gated mutation through `approvalApplierRegistry`, which logs a
 * row it cannot apply and reverts it to `pending` so this sweep picks it up
 * again tomorrow instead of leaving it terminally `timed_out` with the payload
 * never applied. `coParentApprovalsExpired` counts the rows this run flipped,
 * including any that were reverted. A hard failure here is logged and
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

/**
 * Age out `shift_change_requests` nobody ever answered (F-B5-5). Global for
 * the same reason as the approvals sweep, and keyed off `created_at` rather
 * than the shift's start: a request about a shift six weeks out is just as
 * stale on day eight as one about tomorrow, and a request can outlive the
 * shift it was about entirely.
 *
 * Isolated from the approvals sweep as well as from the horizon work — the two
 * read different tables and neither is a reason to skip the other. The
 * repository compare-and-sets on `pending`, so a request answered between the
 * cutoff being computed and the update landing is left alone.
 *
 * ponytail: no push to the requester. `notifyChangeRequestOpened` and friends
 * live on `shiftChangeRequestCommandService` and every push type is a member
 * of `PUSH_NOTIFICATION_TYPES`, which `notificationRouteMap` consumes as an
 * exhaustive `Record` — so telling the requester costs a new notification
 * type, a mobile route, and copy in both locales, not a function call. Worth
 * doing; deliberately not smuggled into this job. Until then a requester finds
 * out by looking, which is the same as today.
 */
async function expireStaleChangeRequests(
  changeRequests: HorizonChangeRequestExpiryRepository
): Promise<number> {
  try {
    const cutoff = new Date(
      Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const expired = await changeRequests.expirePendingOlderThan(cutoff);
    return expired.length;
  } catch (error) {
    logger.error('Schedule horizon job: shift_change_requests expiry failed', {
      error,
    });
    return 0;
  }
}
