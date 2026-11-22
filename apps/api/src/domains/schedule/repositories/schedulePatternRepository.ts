/**
 * Schedule-pattern repository — data access for the `schedule_patterns`
 * table. Ownership/authorization is enforced in the SERVICE layer
 * (membership + role checks), never here.
 *
 * @module domains/schedule/repositories/schedulePatternRepository
 */
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client';
import { schedulePatterns } from '../../../db/schema';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

const details = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export class SchedulePatternRepository extends BaseRepository<
  SchedulePattern,
  typeof schedulePatterns
> {
  constructor() {
    super(schedulePatterns);
  }

  /** Every pattern proposed for a household, newest first. */
  async listForHousehold(householdId: string): Promise<SchedulePattern[]> {
    try {
      return (await db
        .select()
        .from(this.table)
        .where(eq(this.table.household_id, householdId))
        .orderBy(desc(this.table.created_at))) as SchedulePattern[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list schedule patterns for household',
        'DATABASE_ERROR',
        { details: details(err), householdId }
      );
    }
  }

  /**
   * Every currently-`accepted` pattern for ONE (household, carer) — the
   * supersede set `respond`'s accept branch ends, so a household can never
   * hold two accepted usual weeks for the same carer materialising the same
   * days twice (migration 062).
   *
   * `carer_id` is nullable and an unassigned pattern is a real shape (014: a
   * parent sketching a usual week during onboarding, before any nanny
   * exists), so the null case matches `carer_id IS NULL` — `= NULL` would
   * match nothing at all.
   */
  async listAcceptedByHouseholdAndCarer(
    householdId: string,
    carerId: string | null
  ): Promise<SchedulePattern[]> {
    try {
      return (await db
        .select()
        .from(this.table)
        .where(
          and(
            eq(this.table.household_id, householdId),
            eq(this.table.status, 'accepted'),
            carerId
              ? eq(this.table.carer_id, carerId)
              : isNull(this.table.carer_id)
          )
        )) as SchedulePattern[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list accepted schedule patterns for a carer',
        'DATABASE_ERROR',
        { details: details(err), householdId, carerId }
      );
    }
  }

  /**
   * Every currently-accepted pattern across every household — the
   * horizon-rolling job's own trust boundary (see
   * `jobs/scheduleHorizonJob.ts`): it re-materialises every row this
   * returns, unscoped by household or caller, unlike every other read in
   * this domain.
   */
  async listAccepted(): Promise<SchedulePattern[]> {
    try {
      return (await db
        .select()
        .from(this.table)
        .where(eq(this.table.status, 'accepted'))) as SchedulePattern[];
    } catch (err) {
      throw new DatabaseError(
        'Failed to list accepted schedule patterns',
        'DATABASE_ERROR',
        { details: details(err) }
      );
    }
  }
}
