/**
 * Child repository — data access for the `children` table. Extends
 * BaseRepository for standard CRUD and adds two domain queries. Uses the
 * single D1 handle, so membership/role authorization is enforced
 * in the SERVICE layer, never here.
 *
 * @module domains/child/repositories/childRepository
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client';
import { children } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { Child } from '../types';

export class ChildRepository extends BaseRepository<Child, typeof children> {
  constructor() {
    super(children);
  }

  /**
   * Active (non-archived) children for a household, oldest-created first.
   * `findById` (inherited) is used for single-child lookups instead, since an
   * archived child must still resolve there (soft delete, not gone).
   */
  async findActiveByHousehold(householdId: string): Promise<Child[]> {
    try {
      const rows = await db
        .select()
        .from(children)
        .where(
          and(
            eq(children.household_id, householdId),
            isNull(children.archived_at)
          )
        )
        .orderBy(asc(children.created_at));
      return rows as Child[];
    } catch (err) {
      throw this.dbError('Failed to list children for household', err, {
        householdId,
      });
    }
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
