/**
 * Household-closure repository — data access for `household_closures`.
 * Membership/role gates live in the service layer.
 *
 * @module domains/availability/repositories/householdClosureRepository
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { householdClosures } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { HouseholdClosure } from '../types';

export class HouseholdClosureRepository extends BaseRepository<
  HouseholdClosure,
  typeof householdClosures
> {
  constructor() {
    super(householdClosures);
  }

  /** All closures for a household, earliest first. */
  async listByHousehold(householdId: string): Promise<HouseholdClosure[]> {
    try {
      const rows = await db
        .select()
        .from(this.table)
        .where(eq(this.table.household_id, householdId))
        .orderBy(asc(this.table.starts_at));
      return rows as HouseholdClosure[];
    } catch (err) {
      throw this.dbError('Failed to list', err, { householdId });
    }
  }
}
