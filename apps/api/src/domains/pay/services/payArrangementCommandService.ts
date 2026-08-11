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
import { localDateOf } from '../../timesheet/utils/weekStart';
import { UserService } from '../../user';
import {
  PayArrangementNotFoundError,
  PayArrangementValidationError,
} from '../errors/payErrors';
import { PayArrangementRepository } from '../repositories/payArrangementRepository';
import type { CreatePayArrangementRequest, PayArrangement } from '../types';

/** Injectable push seam — defaults to the fire-and-forget household helper. */
export interface PayArrangementPushNotifier {
  notifyUser: (userId: string, payload: PushPayload) => void;
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
    private readonly push: PayArrangementPushNotifier = { notifyUser }
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
    if (request.valid_from > today) {
      // ISO dates compare correctly as strings — both sides are YYYY-MM-DD.
      throw new PayArrangementValidationError('VALID_FROM_IN_FUTURE', {
        householdId,
        carerId,
        validFrom: request.valid_from,
        householdToday: today,
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
    });

    this.notifyCarerOfNewTerms(carerId, householdId);
    return created;
  }

  /**
   * Fire-and-forget push to the carer whose terms just changed — see the
   * module doc. `notifyUser` (`householdPush.ts`) already swallows delivery
   * errors internally; the try/catch here is belt-and-braces against any
   * unexpected SYNCHRONOUS throw, matching
   * `timesheetCommandService.query`'s identical guard around the same call.
   */
  private notifyCarerOfNewTerms(carerId: string, householdId: string): void {
    try {
      this.push.notifyUser(carerId, {
        title: 'Your pay was updated',
        body: 'A parent set new pay terms for you — open My pay to see the details.',
        data: {
          type: PUSH_NOTIFICATION_TYPES.PAY_TERMS_SET,
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
