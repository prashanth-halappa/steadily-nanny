/**
 * User service (minimal) — user_profiles CRUD + account deletion.
 *
 * The `user_profiles` row is the FK parent for device registration and other
 * per-user data, so it MUST be created (upserted) before those. Deleting the
 * profile cascades to the child tables via ON DELETE CASCADE.
 *
 * @module domains/user/services/userService
 */
import type { UserProfile } from '@steadily-nanny/shared-types';
import { HOUSEHOLD_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { SCHEDULE_PATTERN_STATUSES } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { SHIFT_CHANGE_REQUEST_STATUSES } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { supabaseService } from '../../../config/supabase';
import { BaseError, DatabaseError } from '../../../errors';
import { logger } from '../../../middlewares/logger';
import type {
  UpdateProfileInput,
  UpsertProfileInput,
} from '../../../schemas/user.schema';
import { invalidateUserTokenCache } from '../../../utils/cache';
// Every one of these is imported from its own MODULE, never from the domain
// barrel: `domains/household` and `domains/pay` re-export services that
// import `UserService` back, and pulling a barrel here would close that loop
// at module-eval time. `timesheetCommandService` genuinely is such a cycle and
// is loaded lazily below, the same way `shiftChangeRequestCommandService`
// reaches the timesheet barrel.
import { HouseholdMemberRepository } from '../../household/repositories/householdMemberRepository';
import { HouseholdRepository } from '../../household/repositories/householdRepository';
import type { HouseholdMember } from '../../household/types';
import { PayArrangementRepository } from '../../pay/repositories/payArrangementRepository';
import { SchedulePatternRepository } from '../../schedule/repositories/schedulePatternRepository';
import { scheduleMaterialisationService } from '../../schedule/services/scheduleMaterialisationService';
import { TimeEntryRepository } from '../../timesheet/repositories/timeEntryRepository';
import { localDateOf } from '../../timesheet/utils/weekStart';

/**
 * Run one account-teardown step, swallowing whatever it throws.
 *
 * By the time these run the user has asked for their account to be gone and
 * it is going: App Store 5.1.1(v) leaves no room for a deletion that half
 * refuses, and a 500 here would strand the account in exactly the state the
 * teardown exists to prevent. Each step is independent, so one failure must
 * not skip the rest — and `integrityCheckJob`'s memberless sweep is the
 * backstop for anything that gets away.
 */
async function tearDownStep(
  step: string,
  userId: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    logger.error('Account-deletion teardown step failed', {
      step,
      userId,
      details: (error as Error).message,
    });
  }
}

export class UserService {
  /**
   * Create the anchor row if it isn't there, and do nothing at all if it is.
   * Nothing else creates it — there is no trigger on `auth.users` — so any
   * write whose FK points here (households.created_by, household_members.
   * user_id, user_device_info) 23503s for a user who has never PUT their
   * profile. `ignoreDuplicates` makes this `on conflict do nothing`, so it can
   * never overwrite a name or timezone the user already set.
   */
  static async ensureProfile(userId: string): Promise<void> {
    const { error } = await supabaseService
      .from('user_profiles')
      .upsert(
        { user_id: userId },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    if (error) {
      logger.error('Error ensuring user profile:', error);
      throw new DatabaseError(
        'Failed to ensure user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error.message,
        }
      );
    }
  }

  static async upsertProfile(
    userId: string,
    profileData: UpsertProfileInput
  ): Promise<UserProfile> {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          name: profileData.name,
          city: profileData.city,
          country: profileData.country,
          ...(profileData.additional_data
            ? { additional_data: profileData.additional_data }
            : {}),
          // Omitted (not forced to null) when the caller doesn't send one —
          // "seeded from the device" is best-effort, and a client that
          // couldn't detect a zone yet must not clobber one set earlier by a
          // PATCH /users/me. Same conditional-spread shape as
          // `additional_data` above.
          ...(profileData.timezone ? { timezone: profileData.timezone } : {}),
          // Same conditional spread, same reason (099): a client that didn't
          // ask for a number must not clobber one already set by a
          // PATCH /users/me. Clearing a number is the PATCH's job, via null.
          ...(profileData.phone ? { phone: profileData.phone } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error || !data) {
      logger.error('Error upserting user profile:', error);
      throw new DatabaseError(
        'Failed to upsert user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error?.message,
        }
      );
    }

    return data as UserProfile;
  }

  static async getProfileById(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .select(
        'user_id, name, city, country, phone, preferred_locale, timezone, week_starts_on, additional_data'
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching user profile:', error);
      throw new DatabaseError(
        'Failed to fetch user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error.message,
        }
      );
    }

    return (data as UserProfile) ?? null;
  }

  static async updateProfile(
    userId: string,
    updateData: UpdateProfileInput
  ): Promise<UserProfile> {
    const { data, error } = await supabaseService
      .from('user_profiles')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      logger.error('Error updating user profile:', error);
      throw new DatabaseError(
        'Failed to update user profile',
        'DATABASE_ERROR',
        {
          userId,
          dbError: error?.message,
        }
      );
    }

    return data as UserProfile;
  }

  /**
   * Delete a user account: tear down what their leaving leaves behind, remove
   * the profile (cascades all per-user public tables via FK), remove the
   * auth.users record, then reap any household nobody is left in.
   *
   * DELETION NEVER REFUSES. `removeMember`/`leave` throw on a clocked-in
   * member and on removing the owner; App Store guideline 5.1.1(v) requires
   * in-app account deletion, so every one of those guards is a teardown STEP
   * here rather than a refusal.
   *
   * ORDER IS LOAD-BEARING, in two directions:
   *
   * 1. The membership rows are the ONLY record of which households this user
   *    belongs to, and they cascade away with the profile
   *    (`household_members.user_id` is `on delete cascade` — deliberately, see
   *    033's header). So they are captured first and everything keys off the
   *    captured list.
   * 2. Every other FK pointing at a departing user is `on delete set null`
   *    (033's discipline: the parent's payroll record survives the carer's
   *    account). That is right for history and useless for cleanup — once the
   *    profile row goes, the live pay arrangement, the `accepted` schedule
   *    pattern, the running clock and the open change requests are all
   *    anonymous and unfindable. Every teardown step therefore runs BEFORE
   *    the profile delete; only the memberless-household reap runs after,
   *    because it is waiting on precisely that cascade.
   */
  static async deleteUser(userId: string): Promise<void> {
    try {
      invalidateUserTokenCache(userId);

      const memberRepo = new HouseholdMemberRepository();
      // Every status, `removed` included: a past membership is still a
      // household whose last row this deletion might be taking away.
      //
      // Non-fatal like the steps it feeds, and for the same reason: without
      // this list nothing below can run, but "we could not read your
      // memberships" is not a reason to refuse someone their account
      // deletion. The integrity job is the backstop for what gets left.
      let memberships: HouseholdMember[] = [];
      await tearDownStep('capture_memberships', userId, async () => {
        memberships = await memberRepo.listByUser(userId);
      });
      const householdIds = [...new Set(memberships.map(m => m.household_id))];

      await UserService.tearDownBeforeDelete(userId, memberships, memberRepo);

      const { error: profileError } = await supabaseService
        .from('user_profiles')
        .delete()
        .eq('user_id', userId);

      if (profileError) {
        throw new DatabaseError(
          'Failed to delete user profile',
          'DATABASE_ERROR',
          {
            userId,
            dbError: profileError.message,
          }
        );
      }

      const { error: authError } =
        await supabaseService.auth.admin.deleteUser(userId);

      if (authError) {
        throw new DatabaseError(
          'Failed to delete user authentication record',
          'DATABASE_ERROR',
          { userId, dbError: authError.message }
        );
      }

      // AFTER the auth delete, not before: the membership rows only vanish
      // when the profile does, so this is the first moment "is anybody left?"
      // has a truthful answer.
      await tearDownStep('reap_memberless_households', userId, async () => {
        const reaped = await new HouseholdRepository().deleteIfMemberless(
          householdIds
        );
        if (reaped.length > 0) {
          logger.info('Reaped memberless households', {
            count: reaped.length,
            householdIds: reaped,
          });
        }
      });

      logger.info('User account deleted', { userId });
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      throw new DatabaseError(
        'Failed to delete user account',
        'DATABASE_ERROR',
        {
          userId,
          details: (error as Error).message,
        }
      );
    }
  }

  /**
   * Everything `removeMember`/`leave` would have done, run as steps rather
   * than as guards, while the rows still say who they belong to.
   *
   * Two account-wide steps first (a carer has at most one running clock, and
   * her open change requests are hers wherever they were raised), then the
   * per-household ones. Per-household granularity is deliberate: a household
   * whose teardown fails must not take the others down with it.
   */
  private static async tearDownBeforeDelete(
    userId: string,
    memberships: HouseholdMember[],
    memberRepo: HouseholdMemberRepository
  ): Promise<void> {
    await tearDownStep('close_running_entry', userId, () =>
      UserService.closeRunningEntry(userId)
    );
    await tearDownStep('withdraw_change_requests', userId, () =>
      UserService.withdrawOpenChangeRequests(userId)
    );

    if (memberships.length === 0) {
      return;
    }

    const now = new Date();
    const householdIds = [...new Set(memberships.map(m => m.household_id))];
    const timezones = new Map<string, string>();
    await tearDownStep('load_household_timezones', userId, async () => {
      for (const household of await new HouseholdRepository().findByIds(
        householdIds
      )) {
        timezones.set(household.id, household.timezone);
      }
    });

    const payArrangements = new PayArrangementRepository();
    const patternRepo = new SchedulePatternRepository();

    for (const membership of memberships) {
      const householdId = membership.household_id;

      await tearDownStep('end_pay_arrangements', userId, async () => {
        // The date is household-LOCAL, for the same reason `removeMember`'s
        // is: server-UTC "today" is a day out east of UTC and would cut the
        // terms short before a shift already worked. UTC is the fallback only
        // if the household row itself failed to load.
        await payArrangements.endForCarer(
          householdId,
          userId,
          localDateOf(now, timezones.get(householdId) ?? 'UTC')
        );
      });

      await tearDownStep('end_schedule_patterns', userId, () =>
        UserService.endAcceptedPatterns(userId, householdId, patternRepo, now)
      );

      await tearDownStep('promote_owner', userId, () =>
        UserService.promoteSuccessorOwner(userId, membership, memberRepo)
      );
    }
  }

  /**
   * Close the clock instead of refusing the deletion.
   *
   * `removeMember` throws `MemberHasRunningEntryError` here; there is no such
   * option on this path, and leaving it open is the worse of the two
   * failures — the entry's `carer_id` is about to become NULL, so nobody,
   * including support, could ever close it, and the hours would never reach
   * the parent's timesheet.
   *
   * Goes through the real `clockOut` rather than stamping `clock_out_at`
   * directly: it is the only thing that also rolls the entry into the week's
   * timesheet, splits a session that crosses the week boundary, and freezes
   * the scheduled minutes. Loaded lazily because `timesheetCommandService`
   * imports `UserService` — a genuine cycle, and the same trick
   * `shiftChangeRequestCommandService` uses on the same package.
   */
  private static async closeRunningEntry(userId: string): Promise<void> {
    const running = await new TimeEntryRepository().findRunningForCarer(userId);
    if (!running) {
      return;
    }
    const { timesheetCommandService } = await import(
      '../../timesheet/services/timesheetCommandService'
    );
    await timesheetCommandService.clockOut(userId, running.id, {});
  }

  /**
   * Withdraw every change request this user still has open.
   *
   * Left pending they sit in the other side's inbox forever: the only person
   * who could withdraw one is gone, and `respond` writes a `responded_by`
   * pointing at a profile that no longer exists. `expirePendingOlderThan`
   * eventually catches some of them, but only the ones attached to a shift it
   * looks at.
   *
   * One bulk update rather than a listed-then-looped `withdraw` per row: the
   * predicate says exactly what is being changed, and there is no repository
   * query for "this user's open requests" to reuse.
   */
  private static async withdrawOpenChangeRequests(
    userId: string
  ): Promise<void> {
    const { error } = await supabaseService
      .from('shift_change_requests')
      .update({ status: SHIFT_CHANGE_REQUEST_STATUSES.WITHDRAWN })
      .eq('requested_by', userId)
      .eq('status', SHIFT_CHANGE_REQUEST_STATUSES.PENDING);

    if (error) {
      throw new DatabaseError(
        'Failed to withdraw open shift change requests',
        'DATABASE_ERROR',
        { userId, dbError: error.message }
      );
    }
  }

  /**
   * End the carer's accepted usual weeks and withdraw the future shifts they
   * already made.
   *
   * Without this the pattern survives the deletion with `carer_id` set to
   * NULL by 014's `on delete set null` and its status still `accepted` — so
   * `scheduleHorizonJob` keeps finding it in `listAccepted` and keeps
   * materialising shifts nobody is working, out to the horizon, forever.
   *
   * Mirrors `schedulePatternCommandService.endPattern`, which is private to
   * that service: the status flip alone stops new ghosts, and the
   * cancellation clears the ones already on the calendar.
   */
  private static async endAcceptedPatterns(
    userId: string,
    householdId: string,
    patternRepo: SchedulePatternRepository,
    now: Date
  ): Promise<void> {
    const patterns = await patternRepo.listAcceptedByHouseholdAndCarer(
      householdId,
      userId
    );
    for (const pattern of patterns) {
      await patternRepo.update(pattern.id, {
        status: SCHEDULE_PATTERN_STATUSES.ENDED,
      });
      await scheduleMaterialisationService.cancelFutureShiftsForEndedPattern(
        pattern.id,
        now
      );
    }
  }

  /**
   * Hand the household to somebody who can still run it.
   *
   * `removeMember` refuses to remove an owner precisely because a household
   * with no owner has nobody who passes `WRITE_ROLES` — no timesheet
   * approvals, no invites, no member removal, permanently. Deletion cannot
   * refuse, so it promotes instead.
   *
   * "Owner" is the ROLE on the membership row, not `households.created_by`
   * (which is `on delete set null` and grants nothing). The successor is the
   * earliest-joined remaining PARENT: `listActiveByHousehold` already orders
   * by `joined_at` ascending, so the first match is that person. A nanny or
   * helper is never promoted — owner speaks for the family.
   *
   * No parent left means no promotion and no complaint: either the household
   * is about to be reaped as memberless, or `integrityCheckJob` will find it.
   */
  private static async promoteSuccessorOwner(
    userId: string,
    membership: HouseholdMember,
    memberRepo: HouseholdMemberRepository
  ): Promise<void> {
    if (membership.role !== HOUSEHOLD_ROLES.OWNER) {
      return;
    }
    const successor = (
      await memberRepo.listActiveByHousehold(membership.household_id)
    ).find(
      other => other.user_id !== userId && other.role === HOUSEHOLD_ROLES.PARENT
    );
    if (!successor) {
      return;
    }
    await memberRepo.update(successor.id, { role: HOUSEHOLD_ROLES.OWNER });
    logger.info('Promoted a parent to owner on account deletion', {
      householdId: membership.household_id,
      memberId: successor.id,
    });
  }
}
