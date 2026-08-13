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
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_MEMBERSHIP_STATUSES,
} from '../schemas';
import type { HouseholdMember, HouseholdMemberStatus } from '../types';

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
   * The user's membership row for a household, active or `removed`.
   *
   * This is the MONEY-READ lookup: `assertPayrollReader`, `assertPaymentReader`
   * and their expense, pay-terms, settlement and PTO twins all call it and then
   * branch on ROLE ALONE. A removed nanny must still read the hours she worked
   * and the pay she was owed — payroll is an audit trail, not a live surface
   * that vanishes with the badge — so "is, or once was, a member here" is
   * exactly the question, and this is exactly the answer.
   *
   * The name predates `candidate` (D-49). When statuses were `{active,
   * removed}`, "any status" and "is or was a member" were the same set; they
   * are not any more. A `candidate` is a nanny who redeemed a code into a live
   * household and whose terms are not accepted yet — she has no money trail to
   * keep and must read none of the family's, so she is excluded here and every
   * one of those six gates refuses her with its own opaque 404, unchanged.
   *
   * The filter is a POSITIVE `in (...)` list and must stay one. A
   * `neq('status', 'removed')` computes the same set today and admits every
   * status added tomorrow — the one shape that would grant a candidate the
   * household's money with nothing failing (093's header, spec §17).
   *
   * Use `findMembershipIncludingCandidate` where "does a row exist at all" is
   * genuinely the question.
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
      .in('status', HOUSEHOLD_MEMBERSHIP_STATUSES)
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
   * The user's membership row whatever its status, `candidate` included.
   *
   * Two callers, both asking "does a row exist at all" rather than "may this
   * person read anything": `redeemInvite`'s pre-check (the unique
   * `(household_id, user_id)` index makes a fresh insert impossible for a row
   * in ANY state, and refusing before the claim is what stops a no-op burning
   * a single-use code) and the stranded-claim self-heal (a candidate row means
   * the redeem DID land, so there is nothing stranded to release).
   *
   * GRANTS NOTHING. Every caller must decide access from the status it reads
   * back, never from the row merely existing.
   */
  async findMembershipIncludingCandidate(
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
   *
   * ACTIVE ONLY — candidates are deliberately excluded. A `candidate` is a
   * nanny who redeemed a code but whose terms are not accepted yet (D-49); she
   * must not receive household pushes, shift rights, or any other surface that
   * treats this list as "who is live in this household today". Use
   * `listNonRemovedByHousehold` for the one read that must include her.
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
   * Every non-removed member of a household — `active` plus `candidate` —
   * oldest-joined first, with the same `profile_name` embed as the active-only
   * sibling above.
   *
   * THIS IS THE ROSTER READ FOR `GET /v1/households/:id/members` ONLY. The
   * mobile inbox fans terms-proposal queries from it, and D-38's redemption
   * leaves the nanny a `candidate` until acceptance — precisely when the parent
   * must see and accept her proposal. Every other caller that needs "who is
   * live in this household" must keep using `listActiveByHousehold`; widening
   * that method would change push audiences and shift authorization.
   *
   * The filter is a POSITIVE `in (...)` list and must stay one — never
   * `neq('status', 'removed')`, which would admit every status added tomorrow
   * (093's column comment, spec §17).
   */
  async listNonRemovedByHousehold(
    householdId: string
  ): Promise<HouseholdMember[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*, user_profiles(name)')
      .eq('household_id', householdId)
      .in('status', [
        HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
      ])
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
    status?: HouseholdMemberStatus
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
    status: HouseholdMemberStatus
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
   * Soft-remove a membership. Compare-and-set on the two statuses a person can
   * be removed FROM, so a second remove — a retry, or the other parent tapping
   * at the same moment — matches zero rows and returns null instead of
   * reporting a fresh removal. The row is never deleted: `time_entries` and
   * `shifts` reference the member, and their history has to survive the person
   * leaving.
   *
   * `candidate` is in the set because declining is how that window ends (D-49):
   * the parent read her terms and said no, and without it her row had no exit —
   * `reactivateMembership` CASes on `removed` and this CASed on `active`, so
   * she would have been stuck pending forever. Still a positive list, so
   * `removed` matches neither and the double-remove no-op is unaffected.
   */
  async removeMembership(memberId: string): Promise<HouseholdMember | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: HOUSEHOLD_MEMBER_STATUSES.REMOVED })
      .eq('id', memberId)
      .in('status', [
        HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
      ])
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
   * The acceptance transition (§8.2.1): a `candidate` becomes a full member.
   *
   * Called by the terms-proposal service inside the same transaction that
   * inserts the `pay_arrangements` row — one state change, one moment, and it
   * is the moment a human agreed. Nothing else in the codebase may flip this
   * status: the member PATCH refuses everything but `removed`, so household
   * access still costs either a single-use code or an accepted proposal.
   *
   * CAS'd on `status = 'candidate'` for the same reason its two siblings CAS:
   * a second acceptance, or an acceptance racing the parent's decline, must
   * match zero rows rather than resurrect a removed member. `role` and
   * `can_edit` are deliberately untouched — 094 already wrote them as
   * `nanny`/false, and acceptance is not a promotion.
   */
  async activateCandidate(memberId: string): Promise<HouseholdMember | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE })
      .eq('id', memberId)
      .eq('status', HOUSEHOLD_MEMBER_STATUSES.CANDIDATE)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to activate household candidate',
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
