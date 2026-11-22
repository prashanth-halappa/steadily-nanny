/**
 * Handoff note repository — data access for the `handoff_notes` table.
 * Extends BaseRepository for standard CRUD (`findById`/`create`/`update`
 * cover everything this domain needs — there is no delete) and adds the one
 * domain query: a household's notes for a single local date. Membership/role
 * authorization is enforced in the SERVICE layer, never here.
 *
 * @module domains/handoff/repositories/handoffNoteRepository
 */
import type { HandoffNote } from '@steadily-nanny/shared-types/schemas/handoff.schema';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { handoffNotes } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class HandoffNoteRepository extends BaseRepository<
  HandoffNote,
  typeof handoffNotes
> {
  constructor() {
    super(handoffNotes);
  }

  /**
   * A household's handoff notes for one local date (typically a morning and
   * an evening note), oldest-created first. Backs both the list endpoint and
   * the evening recap.
   */
  async findByHouseholdAndDate(
    householdId: string,
    localDate: string
  ): Promise<HandoffNote[]> {
    try {
      const rows = await db
        .select()
        .from(this.table)
        .where(
          and(
            eq(this.table.household_id, householdId),
            eq(this.table.local_date, localDate)
          )
        )
        .orderBy(asc(this.table.created_at));
      return rows as HandoffNote[];
    } catch (err) {
      throw this.dbError('Failed to list', err, { householdId, localDate });
    }
  }
}
