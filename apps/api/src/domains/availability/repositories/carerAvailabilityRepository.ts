/**
 * Carer availability repository — data access for the `carer_availability`
 * table. No row-level security on D1, so ownership/authorization (the
 * shares-household check) is enforced in the SERVICE layer, never here.
 *
 * @module domains/availability/repositories/carerAvailabilityRepository
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { carerAvailability } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { CarerAvailability, CreateCarerAvailabilityInput } from '../types';

export class CarerAvailabilityRepository extends BaseRepository<
  CarerAvailability,
  typeof carerAvailability
> {
  constructor() {
    super(carerAvailability);
  }

  /** All weekday rows a user has set, ordered Sunday (0) -> Saturday (6). */
  async findByUserId(userId: string): Promise<CarerAvailability[]> {
    try {
      const rows = await db
        .select()
        .from(this.table)
        .where(eq(this.table.user_id, userId))
        .orderBy(asc(this.table.weekday));
      return rows as CarerAvailability[];
    } catch (err) {
      throw this.dbError('Failed to list', err, { userId });
    }
  }

  /**
   * Upsert one weekday row on the unique `(user_id, weekday)` key
   * (`carer_availability_user_weekday_idx`). The PUT body always represents
   * exactly one weekday, so a single upsert statement — rather than a
   * select-then-insert/update round trip — is both simpler and avoids a
   * check-then-act race between two concurrent PUTs for the same weekday.
   */
  async upsertForWeekday(
    userId: string,
    weekday: number,
    data: Omit<CreateCarerAvailabilityInput, 'weekday'>
  ): Promise<CarerAvailability> {
    try {
      const rows = await db
        .insert(this.table)
        .values({ ...data, user_id: userId, weekday })
        .onConflictDoUpdate({
          target: [this.table.user_id, this.table.weekday],
          // user_id keeps `set` non-empty when `data` carries no fields.
          set: { ...data, user_id: userId },
        })
        .returning();
      return rows[0] as CarerAvailability;
    } catch (err) {
      throw this.dbError('Failed to upsert', err, { userId, weekday });
    }
  }
}
