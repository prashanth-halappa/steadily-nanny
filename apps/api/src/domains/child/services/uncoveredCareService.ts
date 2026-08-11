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
 * **Push rule (72 hours):** of the windows this call genuinely inserts, only
 * the ones starting within `UNCOVERED_PUSH_WITHIN_MS` of now push
 * immediately — an urgent, actionable gap. Windows further out are persisted
 * silently, tagged `payload.push_gate: 'digest'`, and are picked up by the
 * evening digest job instead. Dedupe is the `shift_events` keyed-unique
 * index — re-detection never re-pushes or re-tags a row.
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
import { HouseholdMemberRepository } from '../../household';
import { notifyHouseholdParents } from '../../notification';
import { ShiftEventRepository } from '../../shift/repositories/shiftEventRepository';
import type { ShiftWithChildren } from '../../shift/repositories/shiftRepository';
import { ShiftRepository } from '../../shift/repositories/shiftRepository';
import { ChildRepository } from '../repositories/childRepository';

export const UNCOVERED_PUSH_WITHIN_MS = 72 * 60 * 60 * 1000;

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

export interface RaiseUncoveredResult {
  /** Rows THIS call created (empty on dedupe-skip or a fully-covered day). */
  inserted: UncoveredWindow[];
  /** The subset of `inserted` a push actually went out for (within 72h). */
  pushed: UncoveredWindow[];
}

export class UncoveredCareService {
  constructor(
    private readonly eventRepo: ShiftEventRepository = new ShiftEventRepository(),
    private readonly shiftRepo: ShiftRepository = new ShiftRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly childRepo: ChildRepository = new ChildRepository()
  ) {}

  /**
   * Idempotently persists uncovered windows as `uncovered_care` shift_events
   * for a household/date — skips any interval already raised for that date.
   * `inserted` is every window this call genuinely created; `pushed` is the
   * subset within `UNCOVERED_PUSH_WITHIN_MS` that a push actually went out
   * for — the rest are tagged `push_gate: 'digest'` for the evening digest.
   */
  async raiseUncoveredOnce(
    args: RaiseUncoveredArgs
  ): Promise<RaiseUncoveredResult> {
    const uncovered = computeUncovered({
      localDate: args.localDate,
      timezone: args.timezone,
      needWindows: args.needWindows,
      shifts: args.shifts,
      closures: args.closures,
    });
    if (uncovered.length === 0) {
      return { inserted: [], pushed: [] };
    }

    const existingKeys = await this.eventRepo.listEventKeysForDate(
      args.householdId,
      args.localDate,
      'uncovered_care'
    );
    const toInsert = uncovered.filter(w => !existingKeys.has(uncoveredKey(w)));
    if (toInsert.length === 0) {
      return { inserted: [], pushed: [] };
    }

    // Computed once, before the insert map, so the persisted `push_gate` and
    // the push decision below agree by construction.
    const now = Date.now();
    const isImmediate = (w: UncoveredWindow): boolean =>
      Date.parse(w.startsAt) - now < UNCOVERED_PUSH_WITHIN_MS;

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
          push_gate: isImmediate(window) ? 'immediate' : 'digest',
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
      return { inserted: [], pushed: [] };
    }

    // The 72h gate sits downstream of `actuallyInserted`, never mixed into
    // it: a window first detected far out is still recorded (for the
    // digest), it just doesn't push now.
    const pushed = actuallyInserted.filter(isImmediate);
    if (pushed.length === 0) {
      return { inserted: actuallyInserted, pushed: [] };
    }

    const causeBody = await this.buildCauseAwareBody(args, pushed);
    const genericBody =
      pushed.length === 1
        ? 'A time you need your nanny is not on the schedule.'
        : `${pushed.length} times you need your nanny are not on the schedule.`;

    try {
      notifyHouseholdParents(
        args.householdId,
        {
          title: 'No one booked',
          body: causeBody ?? genericBody,
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

    return { inserted: actuallyInserted, pushed };
  }

  /** Decline/cancel gaps name the person and shift — generic copy drops the cause. */
  private async buildCauseAwareBody(
    args: RaiseUncoveredArgs,
    windows: readonly UncoveredWindow[]
  ): Promise<string | null> {
    if (args.cause !== 'declined' && args.cause !== 'cancelled') {
      return null;
    }
    const window = windows[0];
    if (!window) {
      return null;
    }

    const dayShifts = await this.shiftRepo.findByHouseholdAndLocalDate(
      args.householdId,
      args.localDate
    );
    const causeShift = pickCauseShift(
      dayShifts,
      args.cause,
      args.actorId,
      window
    );
    if (!causeShift?.carer_id) {
      return null;
    }

    const [members, children] = await Promise.all([
      this.memberRepo.listActiveByHousehold(args.householdId),
      this.childRepo.findActiveByHousehold(args.householdId),
    ]);
    const carerMember = members.find(m => m.user_id === causeShift.carer_id);
    const carerName = resolveMemberDisplayName(carerMember);
    const childName = resolveChildNameForShift(
      causeShift,
      children,
      window.childId
    );
    const verb = args.cause === 'declined' ? 'turned down' : 'cancelled';
    const dayLabel = formatPushShortDate(args.localDate, args.timezone);
    const startLabel = formatPushTime12h(causeShift.starts_at, args.timezone);
    const endLabel = formatPushTime12h(causeShift.ends_at, args.timezone);

    return `${carerName} ${verb} ${dayLabel}, ${startLabel} – ${endLabel} (${childName}).`;
  }
}

export const uncoveredCareService = new UncoveredCareService();

function pickCauseShift(
  shifts: readonly ShiftWithChildren[],
  cause: 'declined' | 'cancelled',
  actorId: string | null | undefined,
  window: UncoveredWindow
): ShiftWithChildren | undefined {
  const candidates = shifts.filter(shift => shift.status === cause);
  if (candidates.length === 0) {
    return undefined;
  }

  const overlapping = candidates.filter(shift =>
    intervalsOverlap(
      shift.starts_at,
      shift.ends_at,
      window.startsAt,
      window.endsAt
    )
  );
  const pool = overlapping.length > 0 ? overlapping : candidates;

  if (cause === 'declined' && actorId) {
    return pool.find(shift => shift.carer_id === actorId) ?? pool[0];
  }
  return pool[0];
}

function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return (
    Date.parse(aStart) < Date.parse(bEnd) &&
    Date.parse(bStart) < Date.parse(aEnd)
  );
}

function resolveMemberDisplayName(
  member:
    | {
        display_name_override?: string | null;
        profile_name?: string | null;
      }
    | undefined
): string {
  const override = member?.display_name_override?.trim();
  if (override) {
    return override;
  }
  const profile = member?.profile_name?.trim();
  if (profile) {
    return profile;
  }
  return 'The nanny';
}

function resolveChildNameForShift(
  shift: ShiftWithChildren,
  children: readonly { id: string; name: string }[],
  fallbackChildId: string
): string {
  const childIds =
    shift.shift_children.length > 0
      ? shift.shift_children.map(row => row.child_id)
      : [fallbackChildId];
  const names = childIds
    .map(id => children.find(child => child.id === id)?.name?.trim())
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    return 'your child';
  }
  return names[0] ?? 'your child';
}

/**
 * Exported for `uncoveredDigestJob`, which reuses this exact date copy.
 * `locale` defaults to `en-GB` (unchanged for every existing caller) — A10
 * passes the recipient's resolved locale so the digest can render this in
 * their own language.
 */
export function formatPushShortDate(
  localDate: string,
  timeZone: string,
  locale = 'en-GB'
): string {
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${localDate}T12:00:00`));
    return formatted.replace(',', '');
  } catch {
    return localDate;
  }
}

/**
 * Exported for `uncoveredDigestJob`, which reuses this exact time copy.
 * `locale` defaults to `en-US` (unchanged for every existing caller) — see
 * `formatPushShortDate`.
 */
export function formatPushTime12h(
  instantIso: string,
  timeZone: string,
  locale = 'en-US'
): string {
  const instant = new Date(instantIso);
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(instant);
    const hour = parts.find(part => part.type === 'hour')?.value ?? '0';
    const minute = parts.find(part => part.type === 'minute')?.value ?? '00';
    const dayPeriod = (
      parts.find(part => part.type === 'dayPeriod')?.value ?? 'am'
    ).toLowerCase();
    return `${hour}:${minute} ${dayPeriod}`;
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(instant)
      .toLowerCase();
  }
}
