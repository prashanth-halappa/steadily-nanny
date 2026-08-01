/**
 * Child repository — data access for the `children` table. Extends
 * BaseRepository for standard CRUD and adds two domain queries. Uses the
 * service-role Supabase client, so membership/role authorization is enforced
 * in the SERVICE layer, never here.
 *
 * @module domains/child/repositories/childRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { Child } from '../types';

export class ChildRepository extends BaseRepository<Child> {
  constructor() {
    super('children');
  }

  /**
   * Active (non-archived) children for a household, oldest-created first.
   * `findById` (inherited) is used for single-child lookups instead, since an
   * archived child must still resolve there (soft delete, not gone).
   */
  async findActiveByHousehold(householdId: string): Promise<Child[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('household_id', householdId)
      .is('archived_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list children for household',
        'DATABASE_ERROR',
        { details: error.message, householdId }
      );
    }
    return (data ?? []) as Child[];
  }

  /**
   * Soft delete — sets `archived_at` rather than removing the row, so an
   * archived child still resolves on last month's approved timesheet.
   */
  async archive(childId: string): Promise<Child> {
    return this.update(childId, {
      archived_at: new Date().toISOString(),
    } as Partial<Child>);
  }
}
