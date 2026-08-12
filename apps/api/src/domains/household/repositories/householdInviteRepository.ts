/**
 * Household invite repository — data access for the `household_invites`
 * table. Uses the service-role Supabase client; the invite lookup-by-code
 * deliberately runs under the service role (no RLS policy lets a stranger
 * select an invite by code), which is also what keeps codes non-enumerable.
 *
 * @module domains/household/repositories/householdInviteRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { HOUSEHOLD_INVITE_STATUSES } from '../schemas';
import type { HouseholdInvite, HouseholdMember } from '../types';

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

export class HouseholdInviteRepository extends BaseRepository<HouseholdInvite> {
  constructor() {
    super('household_invites');
  }

  /** Look up an invite by its human-transcribable code. */
  async findByCode(code: string): Promise<HouseholdInvite | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to look up invite by code',
        'DATABASE_ERROR',
        { details: error.message, code }
      );
    }
    return data as HouseholdInvite | null;
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
    const { data, error } = await supabaseService
      .from(this.table)
      .update({
        status: HOUSEHOLD_INVITE_STATUSES.ACCEPTED,
        accepted_by: acceptedBy,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', HOUSEHOLD_INVITE_STATUSES.PENDING)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to claim invite', 'DATABASE_ERROR', {
        details: error.message,
        id,
      });
    }
    return data as HouseholdInvite | null;
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
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ status: HOUSEHOLD_INVITE_STATUSES.REVOKED })
      .eq('id', id)
      .eq('household_id', householdId)
      .eq('status', HOUSEHOLD_INVITE_STATUSES.PENDING)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError('Failed to revoke invite', 'DATABASE_ERROR', {
        details: error.message,
        id,
      });
    }
    return data as HouseholdInvite | null;
  }

  /**
   * Redeem a NANNY-AUTHORED (draft) invite through 094, which does target
   * resolution, household instantiation, both membership inserts, the children
   * and proposal copies and the claim inside ONE transaction.
   *
   * A database function rather than seven service calls for the reason 094's
   * header gives at length: today's path does its CAS and then does more work,
   * which is why it needs a stranded-claim self-heal, and that crash window
   * gets LARGER once redemption does this much. Here a rolled-back transaction
   * never claimed anything, so there is nothing to heal.
   *
   * `targetHouseholdId` null means "instantiate a new live household from the
   * draft"; non-null is §8.2's absorption target, explicitly picked by the
   * parent so absorption can never silently choose a household.
   *
   * `weekStartsOn` is D-8's workweek for an INSTANTIATED household only (096);
   * null keeps whatever the draft carries. Absorption never reads it — an
   * existing family's pay week is not the redeeming device's to change.
   */
  async redeemDraftHousehold(
    code: string,
    redeemerId: string,
    targetHouseholdId: string | null,
    weekStartsOn: number | null
  ): Promise<RedeemDraftOutcome> {
    const { data, error } = await supabaseService.rpc(
      'redeem_draft_household_invite',
      {
        p_code: code,
        p_redeemer_id: redeemerId,
        p_target_household_id: targetHouseholdId,
        p_week_starts_on: weekStartsOn,
      }
    );

    if (error) {
      throw new DatabaseError(
        'Failed to redeem draft invite',
        'DATABASE_ERROR',
        { details: error.message }
      );
    }
    const payload = data as RedeemDraftOutcome | null;
    if (!payload?.outcome) {
      // No answer at all is not "not a draft": falling through to the ordinary
      // path on a silent failure would run a second redemption attempt against
      // a code the function may already have claimed.
      throw new DatabaseError(
        'Unrecognised draft redemption outcome',
        'DATABASE_ERROR',
        { outcome: null }
      );
    }
    return payload;
  }

  /**
   * Stamp the first time the public terms page rendered for this code (§5.3
   * "Opened"), called unauthenticated by the CF worker.
   *
   * `is('opened_at', null)` makes it idempotent AND makes the timestamp mean
   * what §5.3 says it means: the FIRST open, never the latest. A second render
   * matches zero rows, which is the point — the answer she wants is "did this
   * reach them", deliberately not how many times, from where, or for how long.
   */
  async stampOpened(code: string): Promise<void> {
    const { error } = await supabaseService
      .from(this.table)
      .update({ opened_at: new Date().toISOString() })
      .eq('code', code)
      .is('opened_at', null);

    if (error) {
      throw new DatabaseError('Failed to stamp invite open', 'DATABASE_ERROR', {
        details: error.message,
        code,
      });
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
    const { error } = await supabaseService
      .from(this.table)
      .update({
        status: HOUSEHOLD_INVITE_STATUSES.PENDING,
        accepted_by: null,
        accepted_at: null,
      })
      .eq('id', id)
      .eq('status', HOUSEHOLD_INVITE_STATUSES.ACCEPTED)
      .eq('accepted_by', acceptedBy)
      .eq('accepted_at', acceptedAt);

    if (error) {
      throw new DatabaseError(
        'Failed to release invite claim',
        'DATABASE_ERROR',
        { details: error.message, id }
      );
    }
  }
}
