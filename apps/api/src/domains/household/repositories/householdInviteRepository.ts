/**
 * Household invite repository — data access for the `household_invites`
 * table (D1 via Drizzle). There is no RLS: lookup-by-code is gated by the
 * service, and codes stay non-enumerable because nothing lists them.
 *
 * @module domains/household/repositories/householdInviteRepository
 */
// Straight from the shared package, not the domain barrel: this is the one
// type this repository needs and pulling in the barrel buys nothing here.
import type { PayOfferPromotionOutcome } from '@steadily-nanny/shared-types/schemas/household.schema';
import {
  and,
  desc,
  eq,
  getTableColumns,
  type InferInsertModel,
  is,
  isNull,
  SQL,
  sql,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import {
  children,
  householdInvites,
  householdMembers,
  households,
  termsProposals,
} from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { HOUSEHOLD_INVITE_STATUSES } from '../schemas';
import type { HouseholdInvite, HouseholdMember } from '../types';
import { normalizeInviteCode } from '../utils/inviteCode';

/**
 * Every `outcome` 094's `redeem_draft_household_invite` can answer with.
 *
 * OUTCOMES, NOT EXCEPTIONS (077's pattern): the function raises nothing, and
 * the service maps each of these to the API's own error types. That is what
 * keeps the opaque-404 convention owned by TypeScript, where the rest of it
 * lives, instead of half-expressed in SQL error codes.
 */
export type RedeemDraftOutcome =
  | {
      outcome: 'redeemed';
      instantiated: boolean;
      household_id: string;
      draft_household_id: string;
      carer_id: string;
      membership: HouseholdMember;
      proposal: { id: string } | null;
    }
  | { outcome: 'already_member'; household_id: string; status: string }
  | { outcome: 'proposal_already_open'; household_id: string }
  | {
      outcome:
        | 'invite_unavailable'
        | 'not_a_draft_invite'
        | 'draft_has_no_author'
        | 'self_redemption'
        | 'target_not_permitted';
    };

export class HouseholdInviteRepository extends BaseRepository<
  HouseholdInvite,
  typeof householdInvites
> {
  constructor() {
    super(householdInvites);
  }

  /**
   * Look up an invite by its human-transcribable code.
   *
   * Normalises here rather than in each caller: preview, redeem and the
   * generation uniqueness check all reach this, and a code that works on one
   * path but not another is the worst version of this bug. `R4K92T`,
   * `r4k-92t` and `R4K 92T` are the same code to everyone except a string
   * comparison.
   */
  async findByCode(code: string): Promise<HouseholdInvite | null> {
    try {
      const rows = await db
        .select()
        .from(householdInvites)
        .where(eq(householdInvites.code, normalizeInviteCode(code)))
        .limit(1);
      return (rows[0] as HouseholdInvite | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to look up invite by code in', err, { code });
    }
  }

  /**
   * Every invite this household has ever minted, newest first — the parent's
   * own record of what she sent and what became of it.
   */
  async listByHousehold(householdId: string): Promise<HouseholdInvite[]> {
    try {
      const rows = await db
        .select()
        .from(householdInvites)
        .where(eq(householdInvites.household_id, householdId))
        .orderBy(desc(householdInvites.created_at));
      return rows as HouseholdInvite[];
    } catch (err) {
      throw this.dbError('Failed to list household invites in', err, {
        householdId,
      });
    }
  }

  /**
   * Claim a still-`pending` invite for `acceptedBy`. Compare-and-set on
   * `status = 'pending'`, so exactly ONE of N concurrent redeemers of the same
   * code gets a row back and the rest get `null` — the in-memory status checks
   * in the service cannot decide that on their own, and the unique constraint
   * on `(household_id, user_id)` only catches the SAME user twice, never two
   * different people racing for one code.
   */
  async claimPending(
    id: string,
    acceptedBy: string
  ): Promise<HouseholdInvite | null> {
    try {
      const rows = await db
        .update(householdInvites)
        .set({
          status: HOUSEHOLD_INVITE_STATUSES.ACCEPTED,
          accepted_by: acceptedBy,
          accepted_at: new Date().toISOString(),
        })
        .where(
          and(
            eq(householdInvites.id, id),
            eq(householdInvites.status, HOUSEHOLD_INVITE_STATUSES.PENDING)
          )
        )
        .returning();
      return (rows[0] as HouseholdInvite | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to claim invite in', err, { id });
    }
  }

  /**
   * Revoke a still-`pending` invite. `household_id` is IN the compare-and-set,
   * not checked afterwards, so an invite id from another family matches zero
   * rows and reads as not-found — a parent can never revoke, or learn the
   * existence of, an invite outside their own household. The
   * `status = 'pending'` predicate is what makes revoking a race-safe no-op
   * against a redeem landing at the same instant: whoever writes first wins,
   * and the loser gets null.
   */
  async revokePending(
    id: string,
    householdId: string
  ): Promise<HouseholdInvite | null> {
    try {
      const rows = await db
        .update(householdInvites)
        .set({ status: HOUSEHOLD_INVITE_STATUSES.REVOKED })
        .where(
          and(
            eq(householdInvites.id, id),
            eq(householdInvites.household_id, householdId),
            eq(householdInvites.status, HOUSEHOLD_INVITE_STATUSES.PENDING)
          )
        )
        .returning();
      return (rows[0] as HouseholdInvite | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to revoke invite in', err, { id });
    }
  }

  /**
   * Redeem a NANNY-AUTHORED (draft) invite: target resolution, household
   * instantiation, both membership inserts, the children and proposal copies
   * and the claim, as ONE all-or-nothing D1 batch (port of 094's
   * `redeem_draft_household_invite`, MIGRATION-NOTES §5.9).
   *
   * D1 has no row locks, so the reads below only build the statements and
   * pick the early outcomes. The lock replacement: every write is gated on
   * the invite still being pending and unexpired, and the claim CAS runs LAST,
   * gated on this batch's nanny membership having landed. A batch runs alone
   * on D1's single writer, so the first batch to run takes the code and every
   * later one finds it accepted and writes nothing at all. (Claim-first gated
   * on `accepted_by`/`accepted_at` would let one user's two same-millisecond
   * attempts both pass the gate.) A unique violation anywhere rolls the whole
   * batch back.
   *
   * `targetHouseholdId` null means "instantiate a new live household from the
   * draft"; non-null is §8.2's absorption target, explicitly picked by the
   * parent so absorption can never silently choose a household.
   *
   * `weekStartsOn` is D-8's workweek for an INSTANTIATED household only (096);
   * null keeps whatever the draft carries. Absorption never reads it.
   */
  async redeemDraftHousehold(
    code: string,
    redeemerId: string,
    targetHouseholdId: string | null,
    weekStartsOn: number | null
  ): Promise<RedeemDraftOutcome> {
    try {
      return await this.redeemDraft(
        code,
        redeemerId,
        targetHouseholdId,
        weekStartsOn
      );
    } catch (err) {
      throw this.dbError('Failed to redeem draft invite in', err, {});
    }
  }

  private async redeemDraft(
    code: string,
    redeemerId: string,
    targetHouseholdId: string | null,
    weekStartsOn: number | null
  ): Promise<RedeemDraftOutcome> {
    const now = new Date().toISOString();

    // 1. One outcome for missing / used / expired, so the code's existence
    // never leaks.
    const invite = await this.findByCode(code);
    if (
      !invite ||
      invite.status !== HOUSEHOLD_INVITE_STATUSES.PENDING ||
      invite.expires_at < now
    ) {
      return { outcome: 'invite_unavailable' };
    }

    // 2. Not a draft: the caller falls through to the ordinary redeem.
    const [draft] = await db
      .select()
      .from(households)
      .where(eq(households.id, invite.household_id))
      .limit(1);
    if (draft?.state !== 'draft') {
      return { outcome: 'not_a_draft_invite' };
    }

    // 3–4. The draft's author is the nanny who joins.
    const [author] = draft.created_by
      ? await db
          .select({ user_id: householdMembers.user_id })
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.household_id, draft.id),
              eq(householdMembers.user_id, draft.created_by),
              eq(householdMembers.role, 'nanny'),
              eq(householdMembers.status, 'active')
            )
          )
          .limit(1)
      : [];
    if (!author) return { outcome: 'draft_has_no_author' };
    const nannyId = author.user_id;
    if (nannyId === redeemerId) return { outcome: 'self_redemption' };

    // Every write below lands only while the code is still unclaimed.
    const claimed = sql`EXISTS (SELECT 1 FROM household_invites WHERE id = ${invite.id} AND status = 'pending' AND expires_at >= ${now})`;
    const writes: ReturnType<typeof insertIf>[] = [];

    // 5. Pick the target.
    const instantiated = targetHouseholdId === null;
    let targetId: string;
    let nannyGuard: SQL = claimed;
    if (targetHouseholdId === null) {
      targetId = crypto.randomUUID();
      writes.push(
        insertIf(
          households,
          {
            id: targetId,
            name: draft.name ?? 'Our household',
            timezone: draft.timezone,
            currency: draft.currency,
            jurisdiction: draft.jurisdiction,
            week_starts_on: weekStartsOn ?? draft.week_starts_on,
            state: 'live',
            created_by: redeemerId,
          },
          claimed
        ),
        insertIf(
          householdMembers,
          {
            id: crypto.randomUUID(),
            household_id: targetId,
            user_id: redeemerId,
            role: 'owner',
            can_edit: true,
            status: 'active',
          },
          claimed
        )
      );
      const draftChildren = await db
        .select()
        .from(children)
        .where(
          and(eq(children.household_id, draft.id), isNull(children.archived_at))
        );
      for (const c of draftChildren) {
        writes.push(
          insertIf(
            children,
            {
              id: crypto.randomUUID(),
              household_id: targetId,
              name: c.name,
              birth_date: c.birth_date,
              colour: c.colour,
              avatar_initial: c.avatar_initial,
              routine_notes: c.routine_notes,
            },
            claimed
          )
        );
      }
    } else {
      targetId = targetHouseholdId;
      const permitted = sql`EXISTS (SELECT 1 FROM households WHERE id = ${targetId} AND state = 'live') AND EXISTS (SELECT 1 FROM household_members WHERE household_id = ${targetId} AND user_id = ${redeemerId} AND status = 'active' AND role IN ('owner', 'parent'))`;
      const ok = await db.get<{ ok: number }>(sql`SELECT ${permitted} AS ok`);
      if (!ok?.ok) return { outcome: 'target_not_permitted' };
      // Re-checked inside the batch so a demotion racing us can't slip through.
      nannyGuard = sql`${claimed} AND ${permitted}`;
    }

    // 6. Any existing membership, in any status, answers before the claim.
    const existing = await this.findMembership(targetId, nannyId);
    if (existing) {
      return {
        outcome: 'already_member',
        household_id: targetId,
        status: existing.status,
      };
    }

    // 7. The nanny's membership (D-49: candidate when absorbed).
    const membershipId = crypto.randomUUID();
    writes.push(
      insertIf(
        householdMembers,
        {
          id: membershipId,
          household_id: targetId,
          user_id: nannyId,
          role: 'nanny',
          can_edit: false,
          status: instantiated ? 'active' : 'candidate',
        },
        nannyGuard
      )
    );

    // 8. Copy her latest open draft proposal; the draft's own is untouched.
    const [draftProposal] = await db
      .select()
      .from(termsProposals)
      .where(
        and(
          eq(termsProposals.household_id, draft.id),
          eq(termsProposals.carer_id, nannyId),
          eq(termsProposals.status, 'proposed')
        )
      )
      .orderBy(desc(termsProposals.created_at))
      .limit(1);
    const proposalId = draftProposal ? crypto.randomUUID() : null;
    if (draftProposal && proposalId) {
      writes.push(
        insertIf(
          termsProposals,
          {
            id: proposalId,
            household_id: targetId,
            carer_id: nannyId,
            proposed_by: nannyId,
            direction: 'carer',
            status: 'proposed',
            terms: draftProposal.terms,
            note: draftProposal.note,
            from_invite_id: invite.id,
            carer_display_name: draftProposal.carer_display_name,
          },
          nannyGuard
        )
      );
    }

    // 9. The claim goes LAST and only if her membership landed, so a claim
    // never stands without the redemption it paid for.
    const claim = db
      .update(householdInvites)
      .set({
        status: HOUSEHOLD_INVITE_STATUSES.ACCEPTED,
        accepted_by: redeemerId,
        accepted_at: now,
      })
      .where(
        and(
          eq(householdInvites.id, invite.id),
          eq(householdInvites.status, HOUSEHOLD_INVITE_STATUSES.PENDING),
          sql`${householdInvites.expires_at} >= ${now}`,
          sql`EXISTS (SELECT 1 FROM household_members WHERE id = ${membershipId})`
        )
      )
      .returning({ id: householdInvites.id });

    let claimedRows: { id: string }[];
    try {
      // `writes` always holds her membership, so the batch is never empty.
      const items: BatchItem<'sqlite'>[] = [...writes, claim];
      const results = await db.batch(
        items as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]
      );
      claimedRows = results[results.length - 1] as { id: string }[];
    } catch (err) {
      const mapped = mapDbError(err);
      if (mapped?.constraint === 'terms_proposals_open_unique_idx') {
        return { outcome: 'proposal_already_open', household_id: targetId };
      }
      if (mapped?.constraint === 'household_members_user_household_idx') {
        const raced = await this.findMembership(targetId, nannyId);
        if (raced) {
          return {
            outcome: 'already_member',
            household_id: targetId,
            status: raced.status,
          };
        }
      }
      throw err;
    }
    if (claimedRows.length === 0) {
      // Nothing landed. Still pending means only the absorb permission
      // failed between our read and the batch; otherwise someone else won.
      const now2 = await this.findById(invite.id);
      return now2?.status === HOUSEHOLD_INVITE_STATUSES.PENDING && !instantiated
        ? { outcome: 'target_not_permitted' }
        : { outcome: 'invite_unavailable' };
    }

    const [membership] = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.id, membershipId));
    return {
      outcome: 'redeemed',
      instantiated,
      household_id: targetId,
      draft_household_id: draft.id,
      carer_id: nannyId,
      membership: membership as unknown as HouseholdMember,
      proposal: proposalId ? { id: proposalId } : null,
    };
  }

  private async findMembership(householdId: string, userId: string) {
    const [row] = await db
      .select({ status: householdMembers.status })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.household_id, householdId),
          eq(householdMembers.user_id, userId)
        )
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Stamp the first time the public terms page rendered for this code (§5.3
   * "Opened"), called unauthenticated by the CF worker.
   *
   * The `opened_at IS NULL` predicate makes it idempotent AND makes the
   * timestamp mean the FIRST open, never the latest.
   */
  async stampOpened(code: string): Promise<void> {
    try {
      await db
        .update(householdInvites)
        .set({ opened_at: new Date().toISOString() })
        .where(
          and(
            eq(householdInvites.code, code),
            isNull(householdInvites.opened_at)
          )
        );
    } catch (err) {
      throw this.dbError('Failed to stamp invite open in', err, { code });
    }
  }

  /**
   * Record what `promoteOfferToProposal` (F3, 106) did with this invite's
   * `pay_offer`. A plain update, not a CAS: the promotion runs exactly once
   * per redemption and nothing else ever writes this column. The caller wraps
   * it so a failure here costs a recorded outcome, never the redemption.
   */
  async updatePayOfferPromotion(
    id: string,
    outcome: PayOfferPromotionOutcome
  ): Promise<void> {
    try {
      await db
        .update(householdInvites)
        .set({ pay_offer_promotion: outcome })
        .where(eq(householdInvites.id, id));
    } catch (err) {
      throw this.dbError(
        'Failed to record pay-offer promotion outcome in',
        err,
        {
          id,
          outcome,
        }
      );
    }
  }

  /**
   * Undo a claim whose membership insert failed, so a transient database error
   * doesn't burn a single-use code and lock the invitee out for good. CAS'd on
   * the accepted status, `accepted_by` AND `accepted_at`: the caller passes the
   * claim it actually OBSERVED, so once anyone re-claims the invite —
   * including the same user on a retry — `accepted_at` has moved and a stale
   * caller matches zero rows. Without that third predicate a release can free a
   * claim taken seconds ago and put a consumed single-use code back in play.
   */
  async releaseClaim(
    id: string,
    acceptedBy: string,
    acceptedAt: string
  ): Promise<void> {
    try {
      await db
        .update(householdInvites)
        .set({
          status: HOUSEHOLD_INVITE_STATUSES.PENDING,
          accepted_by: null,
          accepted_at: null,
        })
        .where(
          and(
            eq(householdInvites.id, id),
            eq(householdInvites.status, HOUSEHOLD_INVITE_STATUSES.ACCEPTED),
            eq(householdInvites.accepted_by, acceptedBy),
            eq(householdInvites.accepted_at, acceptedAt)
          )
        );
    } catch (err) {
      throw this.dbError('Failed to release invite claim in', err, { id });
    }
  }
}

/**
 * `INSERT INTO <table> SELECT <row> WHERE <guard>` — an insert that lands only
 * if `guard` holds at write time. Columns not in `row` take their schema
 * default (`$defaultFn`, then the SQL default), as a plain insert would.
 */
function insertIf<T extends SQLiteTable>(
  table: T,
  row: Partial<InferInsertModel<T>>,
  guard: SQL
) {
  const given = row as Record<string, unknown>;
  const values = Object.entries(getTableColumns(table))
    .filter(([, col]) => !col.generated)
    .map(([key, col]) => {
      if (key in given) return sql.param(given[key], col);
      if (col.defaultFn) return sql.param(col.defaultFn(), col);
      if (is(col.default, SQL)) return col.default;
      return sql.param(col.default ?? null, col);
    });
  return db
    .insert(table)
    .select(sql`SELECT ${sql.join(values, sql`, `)} WHERE ${guard}`);
}
