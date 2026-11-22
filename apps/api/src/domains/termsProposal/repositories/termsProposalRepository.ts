/**
 * Terms-proposal repository — data access for `terms_proposals`
 * (`termsProposals` in db/schema/). Extends `BaseRepository` for
 * `findById`; everything else here exists because the base cannot express it.
 *
 * D1 has no RLS — authorization lives in the two services, never here
 * (docs/11-MONEY.md §9) — so every read below filters `household_id` and
 * `carer_id` explicitly; a query with no filter of its own reads across
 * households.
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
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';
import { termsProposals } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { OpenTermsProposalExistsError } from '../errors/termsProposalErrors';
import {
  TERMS_PROPOSAL_STATUSES,
  type TermsProposalDirection,
  type TermsProposalRow,
  type TermsProposalStatus,
} from '../schemas';

/**
 * The PARTIAL unique index from 092. Matched by NAME (via `mapDbError`)
 * rather than on any unique violation — GOLDEN-FIXES #31: "don't skip a
 * unique violation on the bare kind; name the index, or an unrelated
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

/**
 * Writes `updated_at` explicitly on every update: the D1 trigger only stamps
 * it when the statement didn't, and RETURNING can't see the trigger's write
 * (MIGRATION-NOTES §3) — this keeps the returned row's `updated_at` current,
 * as Postgres' BEFORE trigger did.
 */
const nowIso = () => new Date().toISOString();

export class TermsProposalRepository extends BaseRepository<
  TermsProposalRow,
  typeof termsProposals
> {
  constructor() {
    super(termsProposals);
  }

  /**
   * Insert one proposal. A unique violation naming
   * `terms_proposals_open_unique_idx` means this (household, carer) pair
   * already has an open round — see `OpenTermsProposalExistsError` for why
   * that cannot be an `onConflict` clause. Any OTHER unique violation falls
   * through to the `DatabaseError` below on purpose: swallowing it would
   * report an unrelated broken constraint as "there is already a proposal",
   * and the caller would retry forever.
   */
  async create(row: NewTermsProposalRow): Promise<TermsProposalRow> {
    try {
      const [created] = await db.insert(termsProposals).values(row).returning();
      return created as TermsProposalRow;
    } catch (err) {
      if (mapDbError(err)?.constraint === OPEN_PROPOSAL_INDEX) {
        throw new OpenTermsProposalExistsError(row.household_id, row.carer_id);
      }
      throw this.dbError('Failed to create terms proposal', err, {
        operation: 'create',
      });
    }
  }

  /**
   * The one open round for a (household, carer) pair, or null. Taking the
   * first row is safe rather than optimistic here: 092's partial unique index
   * makes "at most one" a database invariant, not a service hope.
   */
  async findOpenForCarer(
    householdId: string,
    carerId: string
  ): Promise<TermsProposalRow | null> {
    try {
      const [found] = await db
        .select()
        .from(termsProposals)
        .where(
          and(
            eq(termsProposals.household_id, householdId),
            eq(termsProposals.carer_id, carerId),
            eq(termsProposals.status, TERMS_PROPOSAL_STATUSES.PROPOSED)
          )
        )
        .limit(1);
      return (found as TermsProposalRow | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to find the open terms proposal', err, {
        householdId,
        carerId,
      });
    }
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
    try {
      const rows = await db
        .select()
        .from(termsProposals)
        .where(
          and(
            eq(termsProposals.household_id, householdId),
            eq(termsProposals.carer_id, carerId)
          )
        )
        .orderBy(desc(termsProposals.created_at));
      return rows as TermsProposalRow[];
    } catch (err) {
      throw this.dbError('Failed to list terms proposals', err, {
        householdId,
        carerId,
      });
    }
  }

  /**
   * Move a row out of `proposed` — countered, accepted or withdrawn.
   *
   * COMPARE-AND-SET on `status = 'proposed'`, and that filter IS the
   * concurrency control: two parents tapping Agree in the same instant both
   * read a `proposed` row, and only one of them matches here (one guarded
   * statement — atomic on D1). The loser gets `null` and the service raises
   * `TermsProposalNotActionableError` rather than writing a second acceptance
   * over the first. Returning the row (not a boolean) means the winner never
   * needs a re-read to answer the request.
   */
  async resolve(
    id: string,
    resolution: TermsProposalResolution
  ): Promise<TermsProposalRow | null> {
    try {
      const [updated] = await db
        .update(termsProposals)
        .set({ ...resolution, updated_at: nowIso() })
        .where(
          and(
            eq(termsProposals.id, id),
            eq(termsProposals.status, TERMS_PROPOSAL_STATUSES.PROPOSED)
          )
        )
        .returning();
      return (updated as TermsProposalRow | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to resolve terms proposal', err, {
        id,
        status: resolution.status,
      });
    }
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
    const now = nowIso();
    try {
      const [withdrawn] = await db
        .update(termsProposals)
        .set({
          status: TERMS_PROPOSAL_STATUSES.WITHDRAWN,
          responded_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(termsProposals.household_id, householdId),
            eq(termsProposals.carer_id, carerId),
            eq(termsProposals.status, TERMS_PROPOSAL_STATUSES.PROPOSED)
          )
        )
        .returning();
      return (withdrawn as TermsProposalRow | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to withdraw open terms proposal', err, {
        householdId,
        carerId,
      });
    }
  }

  /**
   * §5.3's "Viewed" receipt. `viewed_at IS NULL` in the WHERE makes this
   * one-way in the database rather than in a service branch: the FIRST open
   * wins and every later one matches nothing, so the timestamp answers "did
   * this reach them" and can never drift into "when did they last look at
   * it" — whether, never how many times (092's column comment).
   *
   * Returns null when there was nothing to stamp, which the caller reads as
   * "already viewed", not as an error.
   */
  async stampViewed(
    id: string,
    viewedAt: string
  ): Promise<TermsProposalRow | null> {
    try {
      const [stamped] = await db
        .update(termsProposals)
        .set({ viewed_at: viewedAt, updated_at: nowIso() })
        .where(and(eq(termsProposals.id, id), isNull(termsProposals.viewed_at)))
        .returning();
      return (stamped as TermsProposalRow | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to stamp terms proposal as viewed', err, {
        id,
      });
    }
  }
}
