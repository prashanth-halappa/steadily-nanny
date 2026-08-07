/**
 * Household member repository — data access for the `household_members`
 * table, the access spine every other household-scoped table is authorized
 * against (via membership, not an `owner_id` column).
 *
 * @module domains/household/repositories/householdMemberRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { AlreadyMemberError } from '../errors/householdErrors';
import type { HouseholdMember } from '../types';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

/** A member row as PostgREST returns it with the profile embed attached. */
type MemberRowWithProfile = HouseholdMember & {
  user_profiles?: { name: string | null } | null;
};

export class HouseholdMemberRepository extends BaseRepository<HouseholdMember> {
  constructor() {
    super('household_members');
  }

  /** The caller's active membership row for a household, or null. */
  async findActiveMembership(
    householdId: string,
    userId: string
  ): Promise<HouseholdMember | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up household membership',
        'DATABASE_ERROR',
        { details: error.message, householdId, userId }
      );
    }
    return data as HouseholdMember | null;
  }

  /**
   * The user's membership row for a household whatever its status — including
   * `removed`. Used to tell "this invite was redeemed and the membership
   * exists (or existed)" from "the redeem never landed at all"; the active-only
   * lookup can't, because a removed member looks identical to a stranger.
   */
  async findMembershipAnyStatus(
    householdId: string,
    userId: string
  ): Promise<HouseholdMember | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up household membership',
        'DATABASE_ERROR',
        { details: error.message, householdId, userId }
      );
    }
    return data as HouseholdMember | null;
  }

  /**
   * All active members of a household, oldest-joined first, each carrying the
   * member's profile name as `profile_name`. `household_members` has no name
   * column, so without the embed two nannies with no `display_name_override`
   * are indistinguishable everywhere the roster is shown. The embed rides the
   * `user_id -> user_profiles(user_id)` FK (migration 009), same shape as
   * `shiftRepository`'s `shift_children` reads.
   */
  async listActiveByHousehold(householdId: string): Promise<HouseholdMember[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*, user_profiles(name)')
      .eq('household_id', householdId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list household members',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return ((data ?? []) as MemberRowWithProfile[]).map(
      ({ user_profiles, ...member }) => ({
        ...member,
        profile_name: user_profiles?.name ?? null,
      })
    );
  }

  /**
   * Every active membership row for the user, across every household they
   * belong to — lets the mobile app learn its own role per household without
   * re-listing each household's full member roster.
   */
  async listActiveByUser(userId: string): Promise<HouseholdMember[]> {
    return this.listRowsByUser(userId, 'active');
  }

  /**
   * EVERY membership row for the user whatever its status — including
   * `removed`. This is what `GET /v1/users/me/memberships` serves, and the
   * distinction is load-bearing: the client decides "am I onboarded" and "may
   * I write in this household" from these rows, and it cannot gate on a row it
   * never receives. Served through the active-only sibling, a removed nanny
   * arrived at the app indistinguishable from a stranger — reported as a fresh
   * signup, and routed into the wizard away from the pay she is still owed.
   *
   * Use `listActiveByUser` for anything that decides a WRITE is permitted.
   */
  async listByUser(userId: string): Promise<HouseholdMember[]> {
    return this.listRowsByUser(userId);
  }

  private async listRowsByUser(
    userId: string,
    status?: 'active' | 'removed'
  ): Promise<HouseholdMember[]> {
    const base = supabaseService
      .from(this.table)
      .select('*')
      .eq('user_id', userId);
    const { data, error } = await (status
      ? base.eq('status', status)
      : base
    ).order('joined_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list memberships for user',
        'DATABASE_ERROR',
        { details: error.message, userId }
      );
    }
    return (data ?? []) as HouseholdMember[];
  }

  /** Every household id the user actively belongs to. */
  async listActiveHouseholdIds(userId: string): Promise<string[]> {
    return this.listHouseholdIdsByStatus(userId, 'active');
  }

  /**
   * Every household id the user was REMOVED from. A removed nanny keeps
   * read-only access to the hours, expenses and pay history she accrued
   * there (the read gates already allow it) — without this list the app has
   * no route to any of it, because the household disappears from her picker
   * the moment the parent removes her.
   *
   * Disjoint from `listActiveHouseholdIds` by construction: the table holds
   * at most one row per `(household_id, user_id)`.
   */
  async listRemovedHouseholdIds(userId: string): Promise<string[]> {
    return this.listHouseholdIdsByStatus(userId, 'removed');
  }

  private async listHouseholdIdsByStatus(
    userId: string,
    status: 'active' | 'removed'
  ): Promise<string[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('household_id')
      .eq('user_id', userId)
      .eq('status', status);

    if (error) {
      throw new DatabaseError(
        'Failed to list households for user',
        'DATABASE_ERROR',
        { details: error.message, userId }
      );
    }
    return ((data ?? []) as { household_id: string }[]).map(
      row => row.household_id
    );
  }

  /**
   * Soft-remove a membership. Compare-and-set on `status = 'active'`, so a
   * second remove — a retry, or the other parent tapping at the same moment —
   * matches zero rows and returns null instead of reporting a fresh removal.
   * The row is never deleted: `time_entries` and `shifts` reference the member,
   * and their history has to survive the person leaving.
   */
  async removeMembership(memberId: string): Promise<HouseholdMember | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: 'removed' })
      .eq('id', memberId)
      .eq('status', 'active')
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to remove household member',
        'DATABASE_ERROR',
        { details: error.message, memberId }
      );
    }
    return data as HouseholdMember | null;
  }

  /**
   * Bring a removed membership back, on the role the new invite grants — the
   * row already exists, so the unique `(household_id, user_id)` constraint
   * makes a fresh insert impossible. `can_edit` resets to false deliberately:
   * a returning member starts from the same baseline a first-time redeem
   * produces, never whatever rights they held before being removed.
   *
   * CAS'd on `status = 'removed'` so a concurrent reactivation loses.
   */
  async reactivateMembership(
    memberId: string,
    role: string
  ): Promise<HouseholdMember | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: 'active', role, can_edit: false })
      .eq('id', memberId)
      .eq('status', 'removed')
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to reactivate household member',
        'DATABASE_ERROR',
        { details: error.message, memberId }
      );
    }
    return data as HouseholdMember | null;
  }

  /**
   * Insert a membership row, translating the `(user_id, household_id)` unique
   * constraint into a clean AlreadyMemberError instead of a raw 500 — the
   * defence against a concurrent double-redeem racing past the service-level
   * pre-check in `householdCommandService.redeemInvite`.
   */
  async createMembership(
    data: Partial<HouseholdMember>
  ): Promise<HouseholdMember> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new AlreadyMemberError(String(data.household_id));
      }
      throw new DatabaseError(
        'Failed to create household member',
        'DATABASE_ERROR',
        { details: error.message, code: error.code }
      );
    }
    return created as HouseholdMember;
  }
}
