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
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });

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
    const { data, error } = await supabaseService
      .from(this.table)
      .select('household_id')
      .eq('user_id', userId)
      .eq('status', 'active');

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
