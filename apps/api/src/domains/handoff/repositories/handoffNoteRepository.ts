/**
 * Handoff note repository — data access for the `handoff_notes` table.
 * Extends BaseRepository for standard CRUD (`findById`/`create`/`update`
 * cover everything this domain needs — there is no delete) and adds the one
 * domain query: a household's notes for a single local date. Uses the
 * service-role Supabase client, so membership/role authorization is enforced
 * in the SERVICE layer, never here.
 *
 * @module domains/handoff/repositories/handoffNoteRepository
 */
import type { HandoffNote } from '@steadily-nanny/shared-types/schemas/handoff.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class HandoffNoteRepository extends BaseRepository<HandoffNote> {
  constructor() {
    super('handoff_notes');
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
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .eq('local_date', localDate)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list handoff notes for household date',
        'DATABASE_ERROR',
        { details: error.message, householdId, localDate }
      );
    }
    return (data ?? []) as HandoffNote[];
  }
}
