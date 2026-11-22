/**
 * Household member repository — data access for the `household_members`
 * table, the access spine every other household-scoped table is authorized
 * against (via membership, not an `owner_id` column).
 *
 * @module domains/household/repositories/householdMemberRepository
 */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  type SQL,
} from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { householdMembers, userProfiles } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { AlreadyMemberError } from '../errors/householdErrors';
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_MEMBERSHIP_STATUSES,
} from '../schemas';
import type { HouseholdMember, HouseholdMemberStatus } from '../types';

const memberColumns = getTableColumns(householdMembers);

export class HouseholdMemberRepository extends BaseRepository<
  HouseholdMember,
  typeof householdMembers
> {
  constructor() {
    super(householdMembers);
  }

  /** One row matching `where`, or null when none (never throws on zero rows). */
  private async findOne(
    where: SQL | undefined,
    operation: string,
    metadata: Record<string, unknown>
  ): Promise<HouseholdMember | null> {
    try {
      const rows = await db
        .select()
        .from(householdMembers)
        .where(where)
        .limit(1);
      return (rows[0] as HouseholdMember | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to look up membership in', err, {
        ...metadata,
        operation,
      });
    }
  }

  /**
   * Member rows joined to the member's own profile (`user_id`, never
   * `ended_by` — the two FKs into `user_profiles` since 112), with the
   * profile's name always and its phone when `withPhone`.
   */
  private async listWithProfile(
    where: SQL | undefined,
    orderBy: SQL,
    withPhone: boolean,
    operation: string,
    householdId: string
  ): Promise<HouseholdMember[]> {
    try {
      const rows = await db
        .select({
          ...memberColumns,
          profile_name: userProfiles.name,
          profile_phone: userProfiles.phone,
        })
        .from(householdMembers)
        .leftJoin(
          userProfiles,
          eq(userProfiles.user_id, householdMembers.user_id)
        )
        .where(where)
        .orderBy(orderBy);
      return rows.map(({ profile_phone, ...row }) =>
        withPhone ? { ...row, profile_phone } : row
      ) as HouseholdMember[];
    } catch (err) {
      throw this.dbError('Failed to list members of', err, {
        householdId,
        operation,
      });
    }
  }

  /** A CAS update; null when the guard matched no row. */
  private async casUpdate(
    memberId: string,
    set: Partial<HouseholdMember>,
    guard: SQL,
    operation: string
  ): Promise<HouseholdMember | null> {
    try {
      const rows = await db
        .update(householdMembers)
        .set(set)
        .where(and(eq(householdMembers.id, memberId), guard))
        .returning();
      return (rows[0] as HouseholdMember | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to update', err, { memberId, operation });
    }
  }

  /** The caller's active membership row for a household, or null. */
  async findActiveMembership(
    householdId: string,
    userId: string
  ): Promise<HouseholdMember | null> {
    return this.findOne(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, userId),
        eq(householdMembers.status, 'active')
      ),
      'findActiveMembership',
      { householdId, userId }
    );
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
    return this.findOne(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, userId),
        inArray(householdMembers.status, [...HOUSEHOLD_MEMBERSHIP_STATUSES])
      ),
      'findMembershipAnyStatus',
      { householdId, userId }
    );
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
    return this.findOne(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.user_id, userId)
      ),
      'findMembershipIncludingCandidate',
      { householdId, userId }
    );
  }

  /**
   * All active members of a household, oldest-joined first, each carrying the
   * member's profile name as `profile_name`. `household_members` has no name
   * column, so without the embed two nannies with no `display_name_override`
   * are indistinguishable everywhere the roster is shown. The embed rides the
   * `user_id -> user_profiles(user_id)` FK (migration 009), same shape as
   * `shiftRepository`'s `shift_children` reads.
   *
   * THE FK IS NAMED, and must stay named. Since 112 added `ended_by`, this
   * table has TWO foreign keys into `user_profiles` — `user_id` and
   * `ended_by` — and a bare `user_profiles(...)` embed becomes ambiguous:
   * PostgREST refuses the whole query with "Could not embed because more than
   * one relationship was found", a 500 on the roster read every screen makes.
   * It used to work only because there was one FK to pick. Naming the
   * constraint says which relationship this is, and survives the next column
   * that points at `user_profiles`.
   *
   * ACTIVE ONLY — candidates are deliberately excluded. A `candidate` is a
   * nanny who redeemed a code but whose terms are not accepted yet (D-49); she
   * must not receive household pushes, shift rights, or any other surface that
   * treats this list as "who is live in this household today". Use
   * `listNonRemovedByHousehold` for the one read that must include her.
   */
  async listActiveByHousehold(householdId: string): Promise<HouseholdMember[]> {
    return this.listWithProfile(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.status, 'active')
      ),
      asc(householdMembers.joined_at),
      false,
      'listActiveByHousehold',
      householdId
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
   *
   * The embed also carries `phone` (099), and this is the ONLY read in the
   * codebase that selects it for anybody but its owner — `user_profiles` RLS
   * stays owner-only, so a co-member's number leaves the database here or
   * nowhere. It comes back RAW for every row: deciding whose number actually
   * goes on the wire is `householdQueryService.listMembers`' job, not this
   * one's, and that service nulls it on every non-`active` row.
   */
  async listNonRemovedByHousehold(
    householdId: string
  ): Promise<HouseholdMember[]> {
    return this.listWithProfile(
      and(
        eq(householdMembers.household_id, householdId),
        inArray(householdMembers.status, [
          HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
          HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
        ])
      ),
      asc(householdMembers.joined_at),
      true,
      'listNonRemovedByHousehold',
      householdId
    );
  }

  /**
   * Everyone REMOVED from this household since `sinceIso`, most recent
   * departure first, each carrying `profile_name` from the same
   * `user_id -> user_profiles(user_id)` embed the two roster reads use.
   *
   * THIS IS THE FIRST HOUSEHOLD-SCOPED READ THAT SEES A REMOVED ROW.
   * `listNonRemovedByHousehold` filters them out at the query, and the only
   * two reads that do see them — `listByUser`, `listRemovedHouseholdIds` —
   * are self-scoped, so before this the family had no way to be told that
   * somebody left.
   *
   * `findMembershipAnyStatus` could not be reused for it, and not only
   * because it is per-user and `maybeSingle`: it selects `'*'` with NO embed,
   * so every row it returns is a name-less id. A departure card that cannot
   * resolve a name says "somebody left", which is not a card. The embed is
   * the point of this method, not a decoration on it.
   *
   * `gte('ended_at', ...)` also drops every row whose `ended_at` is NULL —
   * every departure that predates 112 — because a NULL comparison is not
   * true. That is exactly 112's intent: old departures stay quiet rather than
   * surfacing as "just now" on the day this ships.
   *
   * Deliberately NO gate here. Who may ask this question is
   * `householdQueryService.listDepartedMembers`' decision, and it is
   * parent-only for a privacy reason a repository cannot see.
   */
  async listDepartedSince(
    householdId: string,
    sinceIso: string
  ): Promise<HouseholdMember[]> {
    return this.listWithProfile(
      and(
        eq(householdMembers.household_id, householdId),
        eq(householdMembers.status, HOUSEHOLD_MEMBER_STATUSES.REMOVED),
        gte(householdMembers.ended_at, sinceIso)
      ),
      desc(householdMembers.ended_at),
      false,
      'listDepartedSince',
      householdId
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
    try {
      const rows = await db
        .select()
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.user_id, userId),
            status ? eq(householdMembers.status, status) : undefined
          )
        )
        .orderBy(asc(householdMembers.joined_at));
      return rows as HouseholdMember[];
    } catch (err) {
      throw this.dbError('Failed to list memberships for user in', err, {
        userId,
        operation: 'listRowsByUser',
      });
    }
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
    try {
      const rows = await db
        .select({ household_id: householdMembers.household_id })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.user_id, userId),
            eq(householdMembers.status, status)
          )
        );
      return rows.map(row => row.household_id);
    } catch (err) {
      throw this.dbError('Failed to list households for user in', err, {
        userId,
        operation: 'listHouseholdIdsByStatus',
      });
    }
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
    return this.casUpdate(
      memberId,
      { status: HOUSEHOLD_MEMBER_STATUSES.REMOVED },
      inArray(householdMembers.status, [
        HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
        HOUSEHOLD_MEMBER_STATUSES.CANDIDATE,
      ]),
      'removeMembership'
    );
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
    return this.casUpdate(
      memberId,
      { status: 'active', role, can_edit: false } as Partial<HouseholdMember>,
      eq(householdMembers.status, 'removed'),
      'reactivateMembership'
    );
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
    return this.casUpdate(
      memberId,
      { status: HOUSEHOLD_MEMBER_STATUSES.ACTIVE },
      eq(householdMembers.status, HOUSEHOLD_MEMBER_STATUSES.CANDIDATE),
      'activateCandidate'
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
    try {
      return await this.create(data);
    } catch (err) {
      if (mapDbError(err)?.kind === 'unique') {
        throw new AlreadyMemberError(String(data.household_id));
      }
      throw err;
    }
  }
}
