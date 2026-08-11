/**
 * Pay arrangement command service (CQRS-lite: writes). One method, three
 * gates, in this order — and the order matters, because the first two decide
 * WHICH error a caller is allowed to see:
 *
 * 1. **Parent gate.** Only an active `owner`/`parent` may set pay terms. A
 *    SINGLE parent suffices: pay changes deliberately do not route through
 *    `approvalGateService` (owner decision 1, 2026-08-04). The nanny cannot
 *    set her own rate, and a helper cannot set anyone's.
 * 2. **D12-class carer assertion.** `carer_id` arrives from the URL — a
 *    client-supplied foreign id on a write, which is exactly the shape of
 *    defects D12/D13/D14. Repositories run as the service role and bypass RLS,
 *    and 041 has no insert policy at all, so THIS is the only gate: the carer
 *    must be an ACTIVE member with role `nanny` OF THIS HOUSEHOLD. "No such
 *    carer" and "not your carer" collapse into one error
 *    (docs/11-MONEY.md §9).
 * 3. **No future-dating.** `valid_from` must be the household's LOCAL today or
 *    earlier (owner decision 4). Backdating stays legal — an open week
 *    recomputes under the new rate while an approved week stays frozen.
 *
 * There is no update and no delete, here or anywhere: arrangements are
 * append-only, and a correction is a new row that supersedes the old one via
 * `effectiveOn`'s `created_at desc` tie-break (migration 041's header).
 *
 * Once written, the carer is notified — fire-and-forget, same discipline as
 * `timesheetCommandService.query`'s `TIMESHEET_QUERIED` push: a push failure
 * must never fail the write that already succeeded. Notified is the CARER
 * only, never the parent who made the change or the household at large —
 * she is the one whose pay just changed, and `notifyUser` (unlike
 * `notifyHouseholdParents`) already respects her own
 * `notification_prefs.disabled_types` opt-out by construction.
 *
 * @module domains/pay/services/payArrangementCommandService
 */
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import {
  HOUSEHOLD_ROLES,
  HouseholdMemberRepository,
  HouseholdRepository,
  NotAHouseholdParentError,
} from '../../household';
import { notifyUser } from '../../notification/services/householdPush';
import type { PushPayload } from '../../notification/types';
import { TimesheetRepository } from '../../timesheet/repositories/timesheetRepository';
import {
  DEFAULT_WEEK_STARTS_ON,
  localDateOf,
  weekStartOfLocalDate,
} from '../../timesheet/utils/weekStart';
import { UserService } from '../../user';
import {
  PayArrangementNotFoundError,
  PayArrangementValidationError,
} from '../errors/payErrors';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import type { WeekEarningsService } from '../services/weekEarningsService';
import type { CreatePayArrangementRequest, PayArrangement } from '../types';
import { weekEarningsService } from './weekEarningsService';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface PayArrangementPushNotifier {
  notifyUser: (userId: string, payload: PushPayload) => void;
}

/**
 * The one interface `create`/`cancelScheduled` need from `TimesheetRepository`
 * — narrowed so a test can supply a stub without constructing the real thing
 * (same seam shape as `AckPushNotifier`).
 */
export interface WeekListRepository {
  listForHousehold: (
    householdId: string,
    carerId?: string
  ) => Promise<readonly { week_start: string; status: string }[]>;
}

/** The one method `create` needs from `WeekEarningsService` — see its own doc. */
export type WeekEarningsComparer = Pick<
  WeekEarningsService,
  'computeForWeekWithArrangements'
>;

/** How far into the future `valid_from` may be set (D-16, spec §6): a bound,
 * not a refusal — the opposite direction of the rule it replaces. */
const MAX_FUTURE_MONTHS = 12;

const MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The horizon date, `months` months after `dateISO` — same UTC-Date-rollover
 * technique as `payTermsPresets.ts`'s `isPresetReviewStale`, so the two
 * "how far is 12 months" answers in this domain can never quietly disagree.
 */
function addMonthsISO(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1 + months, d ?? 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** "Aug 3" — no year, for push copy (spec §6.1/§7.4's worked examples). */
function formatMonthDay(dateISO: string): string {
  const [, m, d] = dateISO.split('-').map(Number);
  return `${MONTHS_ABBR[(m ?? 1) - 1]} ${d}`;
}

/** Roles allowed to write pay terms — the household write roles, unchanged. */
const PAY_WRITE_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

/**
 * Fallback for `carer_display_name` when the member has no override and the
 * carer's profile has no `name` (both nullable). Deliberately the same literal
 * as `timesheetCommandService`'s, and as the backfill in
 * 033_preserve_payroll_on_carer_deletion.sql, so an unnamed carer reads
 * identically across the payroll record.
 */
const UNNAMED_CARER_DISPLAY_NAME = 'Carer';

export class PayArrangementCommandService {
  constructor(
    private readonly payRepo: PayArrangementRepository = new PayArrangementRepository(),
    private readonly memberRepo: HouseholdMemberRepository = new HouseholdMemberRepository(),
    private readonly householdRepo: HouseholdRepository = new HouseholdRepository(),
    // Only `getProfileById` is needed, so tests can inject a lightweight stub
    // instead of the full static class (same seam as timesheetCommandService).
    private readonly userService: Pick<
      typeof UserService,
      'getProfileById'
    > = UserService,
    private readonly push: PayArrangementPushNotifier = { notifyUser },
    // D-16/§7.4: which unapproved weeks might need re-pricing when a change
    // is backdated. `TimesheetRepository`'s own `listForHousehold` already
    // has the shape `WeekListRepository` narrows to.
    private readonly timesheetRepo: WeekListRepository = new TimesheetRepository(),
    private readonly weekEarnings: WeekEarningsComparer = weekEarningsService
  ) {}

  /**
   * Append a new arrangement for (household, carer). Returns the created row.
   *
   * `now` is injectable purely so the household-local date boundary can be
   * tested deterministically on both sides of midnight — production callers
   * never pass it (same convention as `timesheetCommandService.clockIn`).
   */
  async create(
    callerId: string,
    householdId: string,
    carerId: string,
    request: CreatePayArrangementRequest,
    now: () => Date = () => new Date()
  ): Promise<PayArrangement> {
    await this.assertPayWriteRole(callerId, householdId);
    const carerMembership = await this.assertActiveNanny(householdId, carerId);

    const household = await this.householdRepo.findById(householdId);
    const today = localDateOf(now(), household?.timezone ?? 'UTC');
    // D-16 (spec §6): "future valid_from allowed" reverses the T12 cut — the
    // no-future-dating refusal below is GONE. In its place, a bound in the
    // OPPOSITE direction: a `valid_from` more than 12 months out is refused,
    // the same shape of check protecting against a fat-fingered year rather
    // than a genuine scheduled raise.
    const horizon = addMonthsISO(today, MAX_FUTURE_MONTHS);
    if (request.valid_from > horizon) {
      // ISO dates compare correctly as strings — both sides are YYYY-MM-DD.
      throw new PayArrangementValidationError('VALID_FROM_TOO_FAR_IN_FUTURE', {
        householdId,
        carerId,
        validFrom: request.valid_from,
        horizon,
      });
    }

    const carerDisplayName = await this.resolveCarerDisplayName(
      carerId,
      carerMembership.display_name_override
    );

    // No wire default on `request.currency` (Phase 1, T4) — an omitted
    // currency resolves to the household's own currency, never an invented
    // literal. An explicit request currency still wins (additive, keeps a
    // shipped client that always sent one unaffected).
    const currency = request.currency ?? household?.currency ?? 'USD';

    // Written field-by-field, never by spreading `request`: the row must carry
    // exactly the client-settable terms plus the three server-derived values
    // (ids, snapshot name, created_by). `bill_rate_minor` is dormant until
    // Tier 2 and deliberately has no write path.
    const created = await this.payRepo.create({
      household_id: householdId,
      carer_id: carerId,
      rate_minor: request.rate_minor,
      currency,
      overtime_threshold_minutes: request.overtime_threshold_minutes ?? null,
      overtime_multiplier: request.overtime_multiplier,
      // 078's daily tiers and the seventh consecutive day. Written even when
      // omitted, and for the same reason `cancellation_paid_within_hours`
      // below is: null here MEANS "this tier does not exist", so stating it
      // at the call site is the difference between a term the parties agreed
      // and a field somebody forgot. Playbook §2b T17 — this literal has no
      // exhaustiveness check, so a field left out of it silently never
      // persists and the engine prices a week under terms nobody chose.
      overtime_daily_threshold_minutes:
        request.overtime_daily_threshold_minutes ?? null,
      doubletime_daily_threshold_minutes:
        request.doubletime_daily_threshold_minutes ?? null,
      doubletime_multiplier: request.doubletime_multiplier ?? null,
      seventh_day_multiplier: request.seventh_day_multiplier ?? null,
      seventh_day_doubletime_after_minutes:
        request.seventh_day_doubletime_after_minutes ?? null,
      // 080's worked-holiday premium (3-E4). Stated explicitly for the same
      // T17 reason as the five above: null here MEANS "a worked holiday pays
      // the normal rate", so writing it is the difference between a term the
      // parties agreed and a field somebody forgot.
      worked_holiday_multiplier: request.worked_holiday_multiplier ?? null,
      // 082's pay schedule (D-17, T7 reversal) — presentation only, same T17
      // reasoning as the block above: null here means "no pay schedule
      // stated", so writing it explicitly is the difference between a
      // schedule the parties chose and a field somebody forgot.
      pay_frequency: request.pay_frequency ?? null,
      pay_day_of_week: request.pay_day_of_week ?? null,
      pay_day_of_month: request.pay_day_of_month ?? null,
      guaranteed_minutes_per_week: request.guaranteed_minutes_per_week ?? null,
      pto_entitlement_minutes_per_year:
        request.pto_entitlement_minutes_per_year ?? null,
      mileage_rate_per_mile_minor: request.mileage_rate_per_mile_minor ?? null,
      // NULL means NO cancellation pay — an explicit agreement, not "unset"
      // (owner decision 5). Omitting it from the row would be the same value,
      // but writing it makes the intent legible at the call site.
      cancellation_paid_within_hours:
        request.cancellation_paid_within_hours ?? null,
      valid_from: request.valid_from,
      carer_display_name: carerDisplayName,
      note: request.note ?? null,
      created_by: callerId,
      // Opaque documentary-terms bag (Phase 1, T9 storage) — passthrough
      // only, an omitted request resolves to the same empty bag the column
      // defaults to. See payArrangement.schema.ts's comment.
      terms: request.terms ?? {},
    });

    // D-16/§7.4 (M1, the walk-away fix): a BACKDATED change (valid_from <
    // today) may reach into a week Marisol has already worked. "If the app
    // can compute the parent's consequence line it can compute mine" — so
    // this re-prices every affected UNAPPROVED week both ways and pushes
    // `pay_terms_backdated` instead of the generic `pay_terms_set` the
    // moment any of them prices lower under the new terms. A backdated
    // RAISE, or a change with nothing to reprice, stays the ordinary push.
    const isBackdated = request.valid_from < today;
    const reducesAnUnapprovedWeek =
      isBackdated &&
      (await this.backdateReducesAnUnapprovedWeek(
        householdId,
        carerId,
        request.valid_from,
        today,
        created,
        household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON
      ));

    if (reducesAnUnapprovedWeek) {
      this.notifyCarerOfBackdatedReduction(
        carerId,
        householdId,
        created.valid_from
      );
    } else {
      this.notifyCarerOfNewTerms(
        carerId,
        householdId,
        created.valid_from,
        today
      );
    }
    return created;
  }

  /**
   * Cancel a SCHEDULED change (D-16, spec §6) before its date arrives. Not a
   * delete: `pay_arrangements` is append-only, so "cancelling" appends a new
   * row carrying the CURRENTLY in-effect terms with `valid_from` = the
   * scheduled row's own date — it supersedes the scheduled row for that date
   * via `effectiveOn`'s `created_at desc` tie-break, and the history shows
   * both: the change was scheduled, and then it was called off.
   *
   * Refuses once the scheduled date has arrived — it is in effect, and
   * changing it from there is an ordinary `create` (spec §6.1's third case).
   */
  async cancelScheduled(
    callerId: string,
    householdId: string,
    carerId: string,
    arrangementId: string,
    now: () => Date = () => new Date()
  ): Promise<PayArrangement> {
    await this.assertPayWriteRole(callerId, householdId);
    await this.assertActiveNanny(householdId, carerId);

    const scheduled = await this.payRepo.findById(arrangementId);
    if (
      !scheduled ||
      scheduled.household_id !== householdId ||
      scheduled.carer_id !== carerId
    ) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'scheduled_arrangement_not_found',
      });
    }

    const household = await this.householdRepo.findById(householdId);
    const today = localDateOf(now(), household?.timezone ?? 'UTC');
    if (scheduled.valid_from <= today) {
      throw new PayArrangementValidationError(
        'SCHEDULED_CHANGE_ALREADY_IN_EFFECT',
        {
          householdId,
          carerId,
          arrangementId,
          validFrom: scheduled.valid_from,
          householdToday: today,
        }
      );
    }

    const currentlyInEffect = await this.payRepo.effectiveOn(
      householdId,
      carerId,
      today
    );
    if (!currentlyInEffect) {
      // There is nothing agreed to revert TO — this was a first-ever
      // arrangement, scheduled. Narrow and rare; the parent sets ordinary
      // (non-scheduled) terms instead rather than this method inventing a
      // "no terms" row.
      throw new PayArrangementValidationError('NOTHING_TO_REVERT_TO', {
        householdId,
        carerId,
        arrangementId,
      });
    }

    const reverted = await this.payRepo.create({
      household_id: householdId,
      carer_id: carerId,
      rate_minor: currentlyInEffect.rate_minor,
      currency: currentlyInEffect.currency,
      overtime_threshold_minutes: currentlyInEffect.overtime_threshold_minutes,
      overtime_multiplier: currentlyInEffect.overtime_multiplier,
      overtime_daily_threshold_minutes:
        currentlyInEffect.overtime_daily_threshold_minutes ?? null,
      doubletime_daily_threshold_minutes:
        currentlyInEffect.doubletime_daily_threshold_minutes ?? null,
      doubletime_multiplier: currentlyInEffect.doubletime_multiplier ?? null,
      seventh_day_multiplier: currentlyInEffect.seventh_day_multiplier ?? null,
      seventh_day_doubletime_after_minutes:
        currentlyInEffect.seventh_day_doubletime_after_minutes ?? null,
      worked_holiday_multiplier:
        currentlyInEffect.worked_holiday_multiplier ?? null,
      guaranteed_minutes_per_week:
        currentlyInEffect.guaranteed_minutes_per_week,
      pto_entitlement_minutes_per_year:
        currentlyInEffect.pto_entitlement_minutes_per_year,
      mileage_rate_per_mile_minor:
        currentlyInEffect.mileage_rate_per_mile_minor,
      cancellation_paid_within_hours:
        currentlyInEffect.cancellation_paid_within_hours,
      // The SCHEDULED row's own date, not today (module doc) — this is what
      // makes the revert supersede it via the tie-break rather than merely
      // preceding it.
      valid_from: scheduled.valid_from,
      carer_display_name: currentlyInEffect.carer_display_name,
      note: 'Scheduled change cancelled',
      created_by: callerId,
      terms: currentlyInEffect.terms ?? {},
    });

    this.notifyCarerOfCancelledScheduledChange(
      carerId,
      householdId,
      scheduled.valid_from
    );
    return reverted;
  }

  /**
   * §7.4's server-side comparison: re-price every UNAPPROVED week that could
   * be touched by this backdate — `[weekStartOfLocalDate(validFrom), today]`
   * — once under the arrangements as they stood BEFORE this create (fetched
   * BEFORE the insert, so `created` is never counted twice) and once WITH
   * `created` appended, and report whether ANY of them prices lower.
   *
   * Approved weeks are EXCLUDED outright (never fetched into the comparison)
   * — they are frozen and keep their approved totals, exactly as the
   * existing backdating hint already says; re-pricing one would imply it
   * could reopen, which it cannot.
   */
  private async backdateReducesAnUnapprovedWeek(
    householdId: string,
    carerId: string,
    validFrom: string,
    today: string,
    created: PayArrangement,
    weekStartsOn: number
  ): Promise<boolean> {
    const previousArrangements = await this.payRepo.listForCarer(
      householdId,
      carerId
    );
    const nextArrangements = [...previousArrangements, created];

    const firstAffectedWeekStart = weekStartOfLocalDate(
      validFrom,
      weekStartsOn
    );
    const timesheets = await this.timesheetRepo.listForHousehold(
      householdId,
      carerId
    );
    const affectedWeeks = timesheets.filter(
      ts =>
        ts.status !== 'approved' &&
        ts.week_start >= firstAffectedWeekStart &&
        ts.week_start <= today
    );

    for (const week of affectedWeeks) {
      const [before, after] = await Promise.all([
        this.weekEarnings.computeForWeekWithArrangements(
          householdId,
          carerId,
          week.week_start,
          previousArrangements
        ),
        this.weekEarnings.computeForWeekWithArrangements(
          householdId,
          carerId,
          week.week_start,
          nextArrangements
        ),
      ]);
      if (
        before.status === 'ok' &&
        after.status === 'ok' &&
        after.gross_minor < before.gross_minor
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Fire-and-forget push to the carer whose terms just changed — see the
   * module doc. `notifyUser` (`householdPush.ts`) already swallows delivery
   * errors internally; the try/catch here is belt-and-braces against any
   * unexpected SYNCHRONOUS throw, matching
   * `timesheetCommandService.query`'s identical guard around the same call.
   *
   * FORKS ON `valid_from` (D-16, attention spec §1.4): "Your pay terms
   * changed." when it is already in force, "Your pay terms change on
   * {date}." when it is scheduled — one type, two bodies, never a second
   * type for a scheduled change (a second type for the same fact is one
   * fact with two names).
   */
  private notifyCarerOfNewTerms(
    carerId: string,
    householdId: string,
    validFrom: string,
    today: string
  ): void {
    try {
      const title =
        validFrom > today
          ? `Your pay terms change on ${formatMonthDay(validFrom)}.`
          : 'Your pay terms changed.';
      this.push.notifyUser(carerId, {
        title,
        body: 'Open My pay to see the details.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET,
          householdId,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /**
   * N18 (§7.4, M1) — REPLACES `pay_terms_set`, never both. No figures (A8);
   * the before → after table lives in the app, not the push body.
   */
  private notifyCarerOfBackdatedReduction(
    carerId: string,
    householdId: string,
    validFrom: string
  ): void {
    try {
      this.push.notifyUser(carerId, {
        title: `Your terms were changed back to ${formatMonthDay(validFrom)}.`,
        body: "This changes weeks you've already worked. Open Steadily to see which ones.",
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_BACKDATED,
          householdId,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /**
   * N19 (§6.1, M4) — REPLACES `pay_terms_set`, never both. A cancelled raise
   * is announced as a cancelled raise, not as a generic "your terms changed".
   */
  private notifyCarerOfCancelledScheduledChange(
    carerId: string,
    householdId: string,
    scheduledValidFrom: string
  ): void {
    try {
      this.push.notifyUser(carerId, {
        title: 'A change to your terms was called off',
        body: `The new rate that was set to start ${formatMonthDay(scheduledValidFrom)} isn't happening. Your current terms stay as they are.`,
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_SCHEDULED_CHANGE_CANCELLED,
          householdId,
        },
      });
    } catch {
      // notifyUser is sync fire-and-forget; swallow any unexpected throw.
    }
  }

  /** Gate 1 — see the module doc. */
  private async assertPayWriteRole(
    callerId: string,
    householdId: string
  ): Promise<void> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      callerId
    );
    if (!membership || !PAY_WRITE_ROLES.has(membership.role)) {
      throw new NotAHouseholdParentError(
        householdId,
        membership?.role ?? 'none'
      );
    }
  }

  /**
   * Gate 2 — the D12-class assertion. Returns the membership row so the
   * caller can read `display_name_override` off it without a second lookup.
   *
   * A departed carer (`status <> 'active'`) reads as absent here, so no new
   * terms can be written against her — which is precisely why the
   * departed-carer arm in docs/11-MONEY.md §4 tells the UI not to offer the
   * "set a rate" CTA for one.
   */
  private async assertActiveNanny(
    householdId: string,
    carerId: string
  ): Promise<{ role: string; display_name_override: string | null }> {
    const membership = await this.memberRepo.findActiveMembership(
      householdId,
      carerId
    );
    if (!membership || membership.role !== HOUSEHOLD_ROLES.NANNY) {
      throw new PayArrangementNotFoundError(householdId, carerId, {
        reason: 'carer_not_an_active_nanny',
      });
    }
    return membership;
  }

  /**
   * Snapshot the carer's display name AT THIS INSTANT onto the new row (033
   * discipline, review finding 7): the household's pay history must stay
   * legible after the carer's profile is gone, so this is captured on insert
   * and never derived on read.
   *
   * Resolution order matches the mobile `resolveMemberDisplayName` util: the
   * household's own `display_name_override` (what this family calls her) wins
   * over the profile name, and a whitespace-only override counts as absent.
   */
  private async resolveCarerDisplayName(
    carerId: string,
    displayNameOverride: string | null
  ): Promise<string> {
    const override = displayNameOverride?.trim();
    if (override) {
      return override;
    }
    const profile = await this.userService.getProfileById(carerId);
    return profile?.name ?? UNNAMED_CARER_DISPLAY_NAME;
  }
}

// Singleton for controllers/routes that don't need DI.
export const payArrangementCommandService = new PayArrangementCommandService();
