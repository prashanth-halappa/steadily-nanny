/**
 * Uncovered-care detector — alerts when a child's declared need window is NOT
 * covered by any shift on a given local date.
 *
 * The **pure** interval math lives in `@steadily-nanny/shared-types/uncoveredCare`
 * (`computeUncovered`) so the mobile banner and this push can never disagree.
 * This module is the impure shell only: persist `shift_events` rows and fire
 * parent pushes.
 *
 * **Covering shifts:** only `pending`, `confirmed`, and `completed` statuses
 * count as cover; `draft`, `declined`, and `cancelled` do not.
 *
 * **Empty `shift_children`:** an empty set means the shift covers all children
 * for its whole span.
 *
 * **Closures:** household closure intervals suppress detection entirely — the
 * family declared no cover needed for those hours.
 *
 * **Push rule:** parents are pushed whenever this call genuinely inserts at
 * least one new window (`actuallyInserted` non-empty). Dedupe is the
 * `shift_events` keyed-unique index — re-detection never re-pushes.
 *
 * **Accepted quirk:** windows persisted silently before the 72h gate was
 * removed already burned their dedupe key and will never notify.
 *
 * **Causes** are supplied by callers, one per trigger: `cancelled` (a cancel
 * request accepted), `declined` (a carer declined a pending shift),
 * `closureRemoved` (an away-period deleted, re-exposing need), `needsAdded`
 * (a care-hours row written), and `nothingScheduled` (post-materialisation,
 * and the `shiftQueryService.listDayThread` read backstop). The trigger
 * inventory lives in `docs/12-NEED-COVERAGE.md`.
 *
 * Push copy is hardcoded English like every other emitter in this repo; push
 * i18n is a separate deferred concern.
 *
 * @module domains/child/services/uncoveredCareService
 */
// Import the repository file DIRECTLY — never the shift domain barrel.
// `../../shift` re-exports services that import from `../../child`, which
// would create a TDZ cycle when this module's singleton initialises.
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  type ClosureInput,
  type CoveredShiftInput,
  computeUncovered,
  type NeedWindowInput,
  type UncoveredWindow,
  uncoveredKey,
} from '@steadily-nanny/shared-types/uncoveredCare';
import { notifyHouseholdParents } from '../../notification';
import { ShiftEventRepository } from '../../shift/repositories/shiftEventRepository';

export type UncoveredCause =
  | 'cancelled'
  | 'declined'
  | 'needsAdded'
  | 'closureRemoved'
  | 'nothingScheduled';

export interface RaiseUncoveredArgs {
  householdId: string;
  localDate: string;
  timezone: string;
  shifts: readonly CoveredShiftInput[];
  needWindows: readonly NeedWindowInput[];
  closures: readonly ClosureInput[];
  cause: UncoveredCause;
  actorId?: string | null;
  /** Omit this parent from the push fan-out (e.g. they triggered the detection). */
  excludeUserId?: string;
}

export class UncoveredCareService {
  constructor(
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository()
  ) {}

  /**
   * Idempotently persists uncovered windows as `uncovered_care` shift_events
   * for a household/date — skips any interval already raised for that date.
   * Returns only the windows actually inserted.
   */
  async raiseUncoveredOnce(
    args: RaiseUncoveredArgs
  ): Promise<UncoveredWindow[]> {
    const uncovered = computeUncovered({
      localDate: args.localDate,
      timezone: args.timezone,
      needWindows: args.needWindows,
      shifts: args.shifts,
      closures: args.closures,
    });
    if (uncovered.length === 0) {
      return [];
    }

    const existingKeys = await this.eventRepo.listEventKeysForDate(
      args.householdId,
      args.localDate,
      'uncovered_care'
    );
    const toInsert = uncovered.filter(w => !existingKeys.has(uncoveredKey(w)));
    if (toInsert.length === 0) {
      return [];
    }

    const created = await this.eventRepo.insertMany(
      toInsert.map(window => ({
        household_id: args.householdId,
        shift_id: null,
        local_date: args.localDate,
        actor_id: args.actorId ?? null,
        event_type: 'uncovered_care',
        payload: {
          key: uncoveredKey(window),
          child_id: window.childId,
          commitment_id: window.commitmentId,
          starts_at: window.startsAt,
          ends_at: window.endsAt,
          cause: args.cause,
        },
      }))
    );

    // F-B6-5: `ignoreDuplicates` silently no-ops a row a concurrent run
    // already inserted between the key filter above and this call — only
    // report (and push for) the windows THIS call genuinely created, not
    // everything that passed the pre-insert filter. PostgREST's
    // `ignoreDuplicates` cannot target migration 025's expression index, so a
    // bulk insert is NOT idempotent by itself — never re-introduce a push
    // driven by the pre-insert filter.
    const createdKeys = new Set(
      created
        .map(row => row.payload?.key)
        .filter((key): key is string => typeof key === 'string')
    );
    const actuallyInserted = toInsert.filter(w =>
      createdKeys.has(uncoveredKey(w))
    );
    if (actuallyInserted.length === 0) {
      return [];
    }

    try {
      notifyHouseholdParents(
        args.householdId,
        {
          title: 'No one booked',
          body:
            actuallyInserted.length === 1
              ? 'A time you need your nanny is not on the schedule.'
              : `${actuallyInserted.length} times you need your nanny are not on the schedule.`,
          data: {
            type: PUSH_NOTIFICATION_TYPES.UNCOVERED_CARE_DETECTED,
            householdId: args.householdId,
            localDate: args.localDate,
          },
        },
        { excludeUserId: args.excludeUserId }
      );
    } catch {
      // notifyHouseholdParents is sync fire-and-forget; swallow any unexpected throw.
    }

    return actuallyInserted;
  }
}

export const uncoveredCareService = new UncoveredCareService();
