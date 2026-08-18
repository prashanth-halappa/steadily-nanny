/**
 * Terms-proposal repository — data access for `terms_proposals`
 * (supabase/migrations/092_terms_proposals.sql). Extends `BaseRepository` for
 * `findById`; everything else here exists because the base cannot express it.
 *
 * Uses the service-role client, so it bypasses RLS entirely — authorization
 * lives in the two services, never here (docs/11-MONEY.md §9) — but every
 * read below still filters `household_id` and `carer_id` explicitly, because
 * a bypassed-RLS query with no filter of its own reads across households.
 *
 * APPEND-ONLY, WITH TWO EXCEPTIONS THAT ARE NOT EDITS. There is no `update`
 * helper for `terms` and no `delete` helper at all: a counter is a NEW row
 * (`create`), and nothing is ever removed. The only writes to an existing row
 * are `resolve` (the lifecycle stamps on a row that is LEAVING `proposed`)
 * and `stampViewed` (the one-way receipt) — both narrowly typed so no caller
 * can reach `terms` through them. Inheriting `BaseRepository.update`/`delete`
 * is the same known, accepted wart `paymentRepository` documents: nothing in
 * the domain calls them and nothing should start.
 *
 * @module domains/termsProposal/repositories/termsProposalRepository
 */
import type { CreatePayArrangementRequest } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { OpenTermsProposalExistsError } from '../errors/termsProposalErrors';
import {
  TERMS_PROPOSAL_STATUSES,
  type TermsProposalDirection,
  type TermsProposalRow,
  type TermsProposalStatus,
} from '../schemas';

/** Postgres unique_violation error code. */
const UNIQUE_VIOLATION = '23505';

/**
 * The PARTIAL unique index from 092. Named explicitly in the 23505 catch
 * below rather than trusted from the bare code — GOLDEN-FIXES #31: "don't
 * skip a 23505 on the bare error code; name the index, or an unrelated
 * constraint violation becomes a silently dropped row."
 */
const OPEN_PROPOSAL_INDEX = 'terms_proposals_open_unique_idx';

export interface NewTermsProposalRow {
  household_id: string;
  carer_id: string;
  proposed_by: string;
  direction: TermsProposalDirection;
  terms: CreatePayArrangementRequest;
  note: string | null;
  supersedes_id: string | null;
  from_invite_id: string | null;
  carer_display_name: string;
}

/**
 * The lifecycle stamps a row takes as it LEAVES `proposed`. `status` and
 * `responded_at` always travel together — 092's
 * `terms_proposals_responded_at_present` check refuses a resolved row without
 * a date, so §10's "the word appears with a date, every time" stays
 * renderable without a fallback that invents one.
 */
export interface TermsProposalResolution {
  status: TermsProposalStatus;
  responded_at: string;
  accepted_by?: string;
  accepted_arrangement_id?: string;
  responsibility_confirmed?: boolean;
}

export class TermsProposalRepository extends BaseRepository<TermsProposalRow> {
  constructor() {
    super('terms_proposals');
  }

  /**
   * Insert one proposal. A 23505 naming `terms_proposals_open_unique_idx`
   * means this (household, carer) pair already has an open round — see
   * `OpenTermsProposalExistsError` for why that cannot be an `onConflict`
   * clause. Any OTHER 23505 falls through to the `DatabaseError` below on
   * purpose: swallowing it would report an unrelated broken constraint as
   * "there is already a proposal", and the caller would retry forever.
   */
  async create(row: NewTermsProposalRow): Promise<TermsProposalRow> {
    const { data, error } = await supabaseService
      .from(this.table)
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION && namesOpenIndex(error)) {
        throw new OpenTermsProposalExistsError(row.household_id, row.carer_id);
      }
      throw new DatabaseError(
        'Failed to create terms proposal',
        'DATABASE_ERROR',
        { details: error.message, code: error.code }
      );
    }
    return data as TermsProposalRow;
  }

  /**
   * The one open round for a (household, carer) pair, or null. `maybeSingle`
   * is safe rather than optimistic here: 092's partial unique index makes "at
   * most one" a database invariant, not a service hope.
   */
  async findOpenForCarer(
    householdId: string,
    carerId: string
  ): Promise<TermsProposalRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .eq('status', TERMS_PROPOSAL_STATUSES.PROPOSED)
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to find the open terms proposal',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId }
      );
    }
    return data as TermsProposalRow | null;
  }

  /**
   * Every round for one carer, newest first — §7.2's "How we got here". The
   * whole chain in one query rather than walking `supersedes_id` row by row
   * (GOLDEN-FIXES #28): a three-round negotiation is three round-trips that
   * way, and the ordering the UI wants is the one the index already provides
   * (`terms_proposals_household_carer_idx`).
   */
  async listChain(
    householdId: string,
    carerId: string
  ): Promise<TermsProposalRow[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list terms proposals',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId }
      );
    }
    return (data ?? []) as TermsProposalRow[];
  }

  /**
   * Move a row out of `proposed` — countered, accepted or withdrawn.
   *
   * COMPARE-AND-SET on `status = 'proposed'`, and that filter IS the
   * concurrency control: two parents tapping Agree in the same instant both
   * read a `proposed` row, and only one of them matches here. The loser gets
   * `null` and the service raises `TermsProposalNotActionableError` rather
   * than writing a second acceptance over the first. Returning the row (not a
   * boolean) means the winner never needs a re-read to answer the request.
   */
  async resolve(
    id: string,
    resolution: TermsProposalResolution
  ): Promise<TermsProposalRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update(resolution)
      .eq('id', id)
      .eq('status', TERMS_PROPOSAL_STATUSES.PROPOSED)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to resolve terms proposal',
        'DATABASE_ERROR',
        { details: error.message, id, status: resolution.status }
      );
    }
    return data as TermsProposalRow | null;
  }

  /**
   * F8 — withdraw the one open round for a (household, carer) pair, on
   * removal, on leaving, or on account deletion. Same CAS shape as `resolve`:
   * `status = 'proposed'` is both the filter and the concurrency control, so
   * a round already answered (accepted/declined/withdrawn/countered) is left
   * alone rather than overwritten, and two calls racing for the same row only
   * ever let one through. `responded_at` is stamped for the same reason
   * `resolve` always stamps it together with `status` — 092's
   * `terms_proposals_responded_at_present` check refuses a non-`proposed` row
   * with no date.
   *
   * Returns null when there was nothing open to withdraw, which every caller
   * reads as a no-op rather than an error.
   */
  async withdrawOpenForCarer(
    householdId: string,
    carerId: string
  ): Promise<TermsProposalRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({
        status: TERMS_PROPOSAL_STATUSES.WITHDRAWN,
        responded_at: new Date().toISOString(),
      })
      .eq('household_id', householdId)
      .eq('carer_id', carerId)
      .eq('status', TERMS_PROPOSAL_STATUSES.PROPOSED)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to withdraw open terms proposal',
        'DATABASE_ERROR',
        { details: error.message, householdId, carerId }
      );
    }
    return data as TermsProposalRow | null;
  }

  /**
   * §5.3's "Viewed" receipt. `.is('viewed_at', null)` makes this one-way in
   * the database rather than in a service branch: the FIRST open wins and
   * every later one matches nothing, so the timestamp answers "did this reach
   * them" and can never drift into "when did they last look at it" — whether,
   * never how many times (092's column comment).
   *
   * Returns null when there was nothing to stamp, which the caller reads as
   * "already viewed", not as an error.
   */
  async stampViewed(
    id: string,
    viewedAt: string
  ): Promise<TermsProposalRow | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .update({ viewed_at: viewedAt })
      .eq('id', id)
      .is('viewed_at', null)
      .select()
      .maybeSingle();

    if (error) {
      throw new DatabaseError(
        'Failed to stamp terms proposal as viewed',
        'DATABASE_ERROR',
        { details: error.message, id }
      );
    }
    return data as TermsProposalRow | null;
  }
}

/**
 * Does this Postgres error name the open-proposal index? Checks `details` as
 * well as `message` because PostgREST splits the constraint name across the
 * two inconsistently between versions, and a check that only reads one of
 * them fails open into the "swallowed unrelated violation" bug #31 warns
 * about.
 */
function namesOpenIndex(error: {
  message?: string;
  details?: string | null;
}): boolean {
  return `${error.message ?? ''} ${error.details ?? ''}`.includes(
    OPEN_PROPOSAL_INDEX
  );
}
