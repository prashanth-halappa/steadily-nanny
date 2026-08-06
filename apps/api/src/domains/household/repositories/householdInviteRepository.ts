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
import type { HouseholdInvite } from '../types';

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
