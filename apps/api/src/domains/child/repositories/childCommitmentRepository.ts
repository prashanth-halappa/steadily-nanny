/**
 * Child-commitment repository — data access for the `child_commitments`
 * table (a child's fixed weekly life: preschool, school, activities, naps —
 * the hours care is NOT needed; `childCommitments` in db/schema/child.ts). Extends
 * BaseRepository for standard CRUD and adds the household/child list reads
 * `childCommitmentQueryService` and `coverageGapService` need. Runs on the
 * single D1 handle, so membership/role authorization is
 * enforced in the SERVICE layer, never here — same convention as
 * `childRepository`.
 *
 * @module domains/child/repositories/childCommitmentRepository
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { childCommitments, households } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import { HOUSEHOLD_STATES } from '../../household/schemas';
import type { ChildCommitment } from '../types';

/**
 * D1 behaviour change (MIGRATION-NOTES §3): Postgres silently overwrote
 * `household_id` with the child's household; the D1 trigger REJECTS a
 * mismatch (`CHECK constraint failed: child_commitments_household_matches_child`).
 * Callers must pass the child's own household — `childCommitmentCommandService`
 * does, after `childQueryService.getOwned` asserts it.
 */
export class ChildCommitmentRepository extends BaseRepository<
  ChildCommitment,
  typeof childCommitments
> {
  constructor() {
    super(childCommitments);
  }

  /** A child's commitments, oldest-created first. */
  async findByChildId(childId: string): Promise<ChildCommitment[]> {
    try {
      const rows = await db
        .select()
        .from(childCommitments)
        .where(eq(childCommitments.child_id, childId))
        .orderBy(asc(childCommitments.created_at));
      return rows as ChildCommitment[];
    } catch (err) {
      throw this.dbError('Failed to list commitments for child', err, {
        childId,
      });
    }
  }

  /**
   * Every commitment in a household, across all its children — the input
   * shape `uncoveredCareService.raiseUncoveredOnce` needs for a whole-household,
   * one-day gap sweep (a job iterates households, not children one at a
   * time).
   */
  async findByHouseholdId(householdId: string): Promise<ChildCommitment[]> {
    try {
      const rows = await db
        .select()
        .from(childCommitments)
        .where(eq(childCommitments.household_id, householdId))
        .orderBy(asc(childCommitments.created_at));
      return rows as ChildCommitment[];
    } catch (err) {
      throw this.dbError('Failed to list commitments for household', err, {
        householdId,
      });
    }
  }

  /**
   * Distinct LIVE household ids that have at least one care-hours row.
   *
   * This is the enumeration point for the only two scheduled jobs that start
   * from households rather than from rows — `scheduleHorizonJob` and
   * `uncoveredDigestJob` — and its caller set is jobs-only, which is what makes
   * it the right place for the draft filter (093's CRON AUDIT; §12 "Draft,
   * cron": a draft produces no reminder, no digest, no horizon work, no nudge).
   *
   * A draft cannot legally HOLD a commitment — 093's trigger refuses the insert
   * — so in practice this filters nothing today. That is the point: it is the
   * guard for the day a write path or a service-role script gets one in, and it
   * costs one join rather than a digest fired at a nanny with no
   * family.
   */
  async listHouseholdIdsWithCommitments(): Promise<string[]> {
    // One query: the live filter is a join, not a second lookup per household.
    try {
      const rows = await db
        .selectDistinct({ id: childCommitments.household_id })
        .from(childCommitments)
        .innerJoin(households, eq(households.id, childCommitments.household_id))
        .where(eq(households.state, HOUSEHOLD_STATES.LIVE));
      return rows.map(row => row.id);
    } catch (err) {
      throw this.dbError('Failed to list households with commitments', err, {});
    }
  }
}
