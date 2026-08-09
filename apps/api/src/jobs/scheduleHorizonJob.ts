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
 * `withdrawn`: withdrawn means the requester acted. A hard failure of the
 * sweep itself is logged and swallowed rather than failing the whole job.
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
  'expirePendingOlderThan'
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
}

export async function runScheduleHorizonJob(
  patternRepo: AcceptedPatternRepository = new SchedulePatternRepository(),
  commandService: HorizonMaterialisationService = schedulePatternCommandService,
  changeRequests: HorizonChangeRequestExpiryRepository = new ShiftChangeRequestRepository(),
  deps: ScheduleHorizonJobDeps = {}
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

  const changeRequestsExpired = await expireStaleChangeRequests(
    changeRequests,
    deps
  );

  await sweepUncoveredCare(deps);

  return {
    patternsProcessed: patterns.length,
    successCount,
    errorCount,
    changeRequestsExpired,
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
): Promise<number> {
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
    return expired.length;
  } catch (error) {
    logger.error('Schedule horizon job: shift_change_requests expiry failed', {
      error,
    });
    return 0;
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

async function sweepUncoveredCare(deps: ScheduleHorizonJobDeps): Promise<void> {
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
    return;
  }

  if (householdIds.length === 0) {
    return;
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
    return;
  }

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
      logger.error(
        'Schedule horizon job: uncovered-care sweep failed for household',
        {
          householdId: household.id,
          error,
        }
      );
    }
  }
}
