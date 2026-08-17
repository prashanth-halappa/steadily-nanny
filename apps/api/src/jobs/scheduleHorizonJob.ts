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
 * And ages out `shift_change_requests` nobody answered (F-B5-5, migration
 * 064). That table had five statuses and no clock — four reached by somebody
 * DOING something, none by nobody doing anything — so an unanswered request
 * stayed `pending` long after the shift it was about. `EXPIRY_DAYS` days after
 * `created_at` the sweep flips it to `expired`, which is deliberately not
 * `withdrawn`: withdrawn means the requester acted.
 *
 * J1-a (S2): a hard failure of any sweep is logged AND counted into the run's
 * `errorCount` — every sweep still runs to completion (one arm's failure
 * never skips another), but the run itself is no longer allowed to report
 * `success` while a sweep silently did nothing. Before this, only the
 * materialise loop's failures reached `errorCount`; a run where every sweep
 * failed recorded `errorCount: 0, status: 'success'`.
 *
 * SETUP: scheduled daily via pg_cron in migration
 * `026_schedule_horizon_cron.sql` (POST `/api/jobs/schedule-horizon`). Requires
 * Vault secrets `cron_api_base_url` and `cron_job_api_key` (see migration 007).
 *
 * @module jobs/scheduleHorizonJob
 */

import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type {
  Shift,
  ShiftChangeRequest,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { ChildCommitmentRepository } from '../domains/child/repositories/childCommitmentRepository';
import {
  type DetectUncoveredCareArgs,
  detectUncoveredCareForDate,
} from '../domains/child/services/detectUncoveredCareForDate';
import { HouseholdRepository } from '../domains/household/repositories/householdRepository';
import { notifyUser } from '../domains/notification';
import type { PushPayload } from '../domains/notification/types';
import { addDays } from '../domains/pay/utils/localDateSpan';
import { SchedulePatternRepository } from '../domains/schedule/repositories/schedulePatternRepository';
import {
  type SchedulePatternCommandService,
  schedulePatternCommandService,
} from '../domains/schedule/services/schedulePatternCommandService';
import type { SchedulePattern } from '../domains/schedule/types';
import { ShiftChangeRequestRepository } from '../domains/shift/repositories/shiftChangeRequestRepository';
import { ShiftEventRepository } from '../domains/shift/repositories/shiftEventRepository';
import { ShiftRepository } from '../domains/shift/repositories/shiftRepository';
import { localDateOf } from '../domains/timesheet/utils/weekStart';
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

/**
 * S8 retention — how long machine-generated `shift_events` rows are kept.
 *
 * 90 days, chosen against what actually reads them, not by feel. The uncovered
 * digest's deepest lookback is the previous household-local day plus a
 * 3-day "closing in" recompute (docs/12-NEED-COVERAGE.md §5); the day thread
 * renders one date at a time. Ninety days is a full quarter of "why was that
 * Tuesday uncovered" audit, comfortably past any conversation about it and
 * past a pay period plus a dispute window — and short enough that the table
 * stops being unbounded, which is the whole finding.
 *
 * ponytail: a plain windowed DELETE, not partitioning and not compaction.
 * Partitioning `shift_events` by month means a table rewrite, re-issuing the
 * RLS policy, and touching seven RPCs that insert into it (019/027/029/030/
 * 031/034/071) — a large, risky change to buy a fast DROP PARTITION nobody is
 * waiting on. Compaction (keep the newest row per key) is worse: it must
 * understand every payload shape to know what "the same fact" means, and gets
 * it wrong the first time a new event type lands. Upgrade path if the volume
 * ever justifies it: partition by `created_at` month and drop whole
 * partitions, keeping the same allowlist so thread rows stay outside it.
 */
const EVENT_RETENTION_DAYS = 90;

/**
 * The allowlist S8 sweeps. MACHINE OUTPUT ONLY — see
 * `ShiftEventRepository.deleteSweptEventsOlderThan` for why this must never
 * become a denylist, and for the list of types that must never be added.
 *
 * S9 / D-25 — THIS IS WHERE UNCOVERED RETRACTION WOULD HAVE GONE, and it is
 * deliberately absent. When a gap is filled, no compensating event is written
 * and no existing row is edited: the log is evidence of what was detected, not
 * state, and every surface recomputes current truth from live shifts,
 * commitments and closures. The original defect this feature was born from was
 * a banner that read the event log instead of recomputing, and a retraction
 * event would rebuild exactly that — a second, lagging source of truth for a
 * question already answered correctly. Aging a row out is not retracting it:
 * it never said the gap was still open, only that it was once seen.
 */
const SWEEPABLE_EVENT_TYPES: readonly string[] = [
  'uncovered_care',
  'pattern_conflict',
];

/**
 * Uncovered-care backstop window — one `detectUncoveredCareForDate` call per
 * household-local day in `[today, today + UNCOVERED_DETECTION_DAYS]`.
 *
 * ponytail: 30×N sequential detector calls per run (N = households with care
 * hours). Batch/SQL scan if daily-job duration becomes a problem.
 */
const UNCOVERED_DETECTION_DAYS = 30;

export interface ScheduleHorizonJobResult {
  patternsProcessed: number;
  successCount: number;
  errorCount: number;
  changeRequestsExpired: number;
  /** A5: of those, the ones expired because their shift had already started. */
  changeRequestsExpiredForStartedShifts: number;
  /** S8: machine-generated `shift_events` rows aged out this run. */
  eventsSwept: number;
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

/** The narrow change-request-expiry contract this job depends on, for injecting a fake in tests. */
export type HorizonChangeRequestExpiryRepository = Pick<
  ShiftChangeRequestRepository,
  'expirePendingOlderThan' | 'expirePendingForStartedShifts'
>;

/** The narrow retention contract (S8), for injecting a fake in tests. */
export type HorizonEventRetentionRepository = Pick<
  ShiftEventRepository,
  'deleteSweptEventsOlderThan'
>;

export type HorizonShiftLookupRepository = Pick<ShiftRepository, 'findByIds'>;

export type HorizonCommitmentRepository = Pick<
  ChildCommitmentRepository,
  'listHouseholdIdsWithCommitments'
>;

export type HorizonHouseholdRepository = Pick<HouseholdRepository, 'findByIds'>;

export type HorizonUncoveredDetector = (
  args: DetectUncoveredCareArgs
) => Promise<unknown>;

export type HorizonUserNotifier = (
  userId: string,
  payload: PushPayload
) => void;

export interface ScheduleHorizonJobDeps {
  shifts?: HorizonShiftLookupRepository;
  commitments?: HorizonCommitmentRepository;
  households?: HorizonHouseholdRepository;
  detectUncovered?: HorizonUncoveredDetector;
  notifyUser?: HorizonUserNotifier;
  events?: HorizonEventRetentionRepository;
}

export async function runScheduleHorizonJob(
  patternRepo: AcceptedPatternRepository = new SchedulePatternRepository(),
  commandService: HorizonMaterialisationService = schedulePatternCommandService,
  changeRequests: HorizonChangeRequestExpiryRepository = new ShiftChangeRequestRepository(),
  deps: ScheduleHorizonJobDeps = {}
): Promise<ScheduleHorizonJobResult> {
  const patterns = await patternRepo.listAccepted();

  let successCount = 0;
  let materialiseErrorCount = 0;

  for (const pattern of patterns) {
    try {
      await commandService.materialiseForHorizon(pattern);
      successCount++;
    } catch (error) {
      materialiseErrorCount++;
      logger.error('Schedule horizon job failed to materialise a pattern', {
        patternId: pattern.id,
        error,
      });
    }
  }

  const changeRequestsResult = await expireStaleChangeRequests(
    changeRequests,
    deps
  );

  const startedShiftsResult = await expireChangeRequestsForStartedShifts(
    changeRequests,
    deps
  );

  const uncoveredCareResult = await sweepUncoveredCare(deps);

  const eventsResult = await sweepOldMachineEvents(deps);

  const errorCount =
    materialiseErrorCount +
    changeRequestsResult.errorCount +
    startedShiftsResult.errorCount +
    uncoveredCareResult.errorCount +
    eventsResult.errorCount;

  return {
    patternsProcessed: patterns.length,
    successCount,
    errorCount,
    changeRequestsExpired: changeRequestsResult.expired,
    changeRequestsExpiredForStartedShifts: startedShiftsResult.expired,
    eventsSwept: eventsResult.swept,
    message: `Rolled the materialisation horizon forward for ${successCount}/${patterns.length} accepted schedule pattern(s)`,
  };
}

/**
 * Age out `shift_change_requests` nobody ever answered (F-B5-5). Global for
 * the same reason as other sweeps, and keyed off `created_at` rather than the
 * shift's start: a request about a shift six weeks out is just as stale on
 * day eight as one about tomorrow, and a request can outlive the shift it was
 * about entirely.
 *
 * Isolated from the horizon work — the two read different tables and neither
 * is a reason to skip the other. The repository compare-and-sets on `pending`,
 * so a request answered between the cutoff being computed and the update
 * landing is left alone.
 */
async function expireStaleChangeRequests(
  changeRequests: HorizonChangeRequestExpiryRepository,
  deps: ScheduleHorizonJobDeps
): Promise<{ expired: number; errorCount: number }> {
  try {
    const cutoff = new Date(
      Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const expired = await changeRequests.expirePendingOlderThan(cutoff);
    try {
      await notifyExpiredChangeRequests(expired, deps);
    } catch (error) {
      logger.error('Schedule horizon job: expired change-request push failed', {
        error,
      });
    }
    return { expired: expired.length, errorCount: 0 };
  } catch (error) {
    logger.error('Schedule horizon job: shift_change_requests expiry failed', {
      error,
    });
    return { expired: 0, errorCount: 1 };
  }
}

/**
 * A5 — the arm the `created_at` sweep above structurally cannot cover.
 *
 * `expireStaleChangeRequests` keys on age, so a request opened yesterday about
 * tomorrow's 08:00 shift is six days from its cutoff: it sits `pending` right
 * through the morning it was about, telling both sides a decision is still
 * available for a shift that already happened. This arm closes any pending
 * request whose shift has started.
 *
 * `expired`, NOT auto-accepted and NOT auto-declined (spec §6.2). The terminal
 * rule for the case that matters — an unanswered CANCEL request — is that the
 * shift STANDS: silence never cancels a shift, for the same reason silence
 * never approves one, and the shift's own record carries what actually
 * happened. Nothing here touches the shift row.
 *
 * ponytail: `starts_at <= now`, not "starts within N hours". Expiring a
 * request while the counterparty could still legitimately answer it would take
 * a decision away from them to satisfy a tidiness goal. The nightly tick means
 * a request is closed by the next morning at the latest rather than seven days
 * later, which is the actual defect; sub-day precision buys nothing, because
 * the shift is already over either way. If a product reason for closing it AT
 * the start instant appears, the 5-minute `coverAskExpiryJob` is the tick to
 * hang it on — not a faster horizon job.
 *
 * The requester gets the same `change_request_expired` push the age-based arm
 * sends: same fact, same words, and a second type for "expired because the
 * shift arrived" would be one fact with two names.
 */
async function expireChangeRequestsForStartedShifts(
  changeRequests: HorizonChangeRequestExpiryRepository,
  deps: ScheduleHorizonJobDeps
): Promise<{ expired: number; errorCount: number }> {
  try {
    const expired = await changeRequests.expirePendingForStartedShifts(
      new Date().toISOString()
    );
    try {
      await notifyExpiredChangeRequests(expired, deps);
    } catch (error) {
      logger.error('Schedule horizon job: started-shift expiry push failed', {
        error,
      });
    }
    return { expired: expired.length, errorCount: 0 };
  } catch (error) {
    logger.error(
      'Schedule horizon job: started-shift change-request expiry failed',
      { error }
    );
    return { expired: 0, errorCount: 1 };
  }
}

/**
 * S8 — age out machine-generated `shift_events`.
 *
 * Isolated like every other arm — its failure never skips a sibling sweep —
 * but J1-a: no longer swallowed. A retention sweep failing is still logged
 * and still counted into the run's `errorCount`, because "the sweep threw"
 * is itself worth a human looking at even though the consequence (a slowly
 * growing table) is not urgent. See `SWEEPABLE_EVENT_TYPES` for what is in
 * scope and `ShiftEventRepository.deleteSweptEventsOlderThan` for why the
 * list is an allowlist.
 */
async function sweepOldMachineEvents(
  deps: ScheduleHorizonJobDeps
): Promise<{ swept: number; errorCount: number }> {
  const eventRepo = deps.events ?? new ShiftEventRepository();
  try {
    const cutoff = new Date(
      Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const swept = await eventRepo.deleteSweptEventsOlderThan(
      cutoff,
      SWEEPABLE_EVENT_TYPES
    );
    return { swept, errorCount: 0 };
  } catch (error) {
    logger.error('Schedule horizon job: shift_events retention sweep failed', {
      error,
    });
    return { swept: 0, errorCount: 1 };
  }
}

async function notifyExpiredChangeRequests(
  expired: ShiftChangeRequest[],
  deps: ScheduleHorizonJobDeps
): Promise<void> {
  const notify = deps.notifyUser ?? notifyUser;
  const shiftRepo = deps.shifts ?? new ShiftRepository();
  const withRequester = expired.filter(
    (row): row is ShiftChangeRequest & { requested_by: string } =>
      typeof row.requested_by === 'string'
  );
  if (withRequester.length === 0) {
    return;
  }

  const shiftIds = [...new Set(withRequester.map(row => row.shift_id))];
  const shifts = await shiftRepo.findByIds(shiftIds);
  const shiftById = new Map(shifts.map(shift => [shift.id, shift]));

  for (const request of withRequester) {
    const shift = shiftById.get(request.shift_id);
    if (!shift) {
      logger.error('Expired change request references missing shift', {
        changeRequestId: request.id,
        shiftId: request.shift_id,
      });
      continue;
    }
    try {
      notify(
        request.requested_by,
        buildExpiredChangeRequestPayload(shift, request)
      );
    } catch (error) {
      logger.error('Failed to notify requester of expired change request', {
        changeRequestId: request.id,
        requestedBy: request.requested_by,
        error,
      });
    }
  }
}

function buildExpiredChangeRequestPayload(
  shift: Shift,
  request: ShiftChangeRequest
): PushPayload {
  return {
    title: 'Change request expired',
    body: `Your change request for ${formatLocalDateLabel(shift.local_date)} expired without a response.`,
    data: {
      type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_EXPIRED,
      shiftId: shift.id,
      changeRequestId: request.id,
      householdId: shift.household_id,
    },
  };
}

function formatLocalDateLabel(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(
    'en-US',
    {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }
  );
}

/**
 * J1-a: every failure branch here used to return `void` — logged, then lost.
 * Each now contributes to the returned `errorCount` so a backstop that never
 * ran (listing households failed, loading them failed) or a household whose
 * detection loop threw is reflected in the run's own status, not just a log
 * line nobody is paged on.
 */
async function sweepUncoveredCare(
  deps: ScheduleHorizonJobDeps
): Promise<{ errorCount: number }> {
  const commitmentRepo = deps.commitments ?? new ChildCommitmentRepository();
  const householdRepo = deps.households ?? new HouseholdRepository();
  const detect =
    deps.detectUncovered ?? (args => detectUncoveredCareForDate(args));

  let householdIds: string[];
  try {
    householdIds = await commitmentRepo.listHouseholdIdsWithCommitments();
  } catch (error) {
    logger.error(
      'Schedule horizon job: failed to list households with care hours',
      {
        error,
      }
    );
    return { errorCount: 1 };
  }

  if (householdIds.length === 0) {
    return { errorCount: 0 };
  }

  let households: Awaited<ReturnType<HorizonHouseholdRepository['findByIds']>>;
  try {
    households = await householdRepo.findByIds(householdIds);
  } catch (error) {
    logger.error(
      'Schedule horizon job: failed to load households for uncovered sweep',
      {
        error,
      }
    );
    return { errorCount: 1 };
  }

  let errorCount = 0;
  for (const household of households) {
    try {
      const today = localDateOf(new Date(), household.timezone);
      const windowEnd = addDays(today, UNCOVERED_DETECTION_DAYS);
      for (
        let localDate = today;
        localDate <= windowEnd;
        localDate = addDays(localDate, 1)
      ) {
        await detect({
          householdId: household.id,
          localDate,
          cause: 'nothingScheduled',
        });
      }
    } catch (error) {
      errorCount++;
      logger.error(
        'Schedule horizon job: uncovered-care sweep failed for household',
        {
          householdId: household.id,
          error,
        }
      );
    }
  }
  return { errorCount };
}
