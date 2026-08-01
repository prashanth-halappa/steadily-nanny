/**
 * Carer availability repository — data access for the `carer_availability`
 * table. Uses the service-role Supabase client, so ownership/authorization
 * (the shares-household check) is enforced in the SERVICE layer, never here.
 *
 * @module domains/availability/repositories/carerAvailabilityRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { CarerAvailability, CreateCarerAvailabilityInput } from '../types';

export class CarerAvailabilityRepository extends BaseRepository<CarerAvailability> {
  constructor() {
    super('carer_availability');
  }

  /** All weekday rows a user has set, ordered Sunday (0) -> Saturday (6). */
  async findByUserId(userId: string): Promise<CarerAvailability[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('user_id', userId)
      .order('weekday', { ascending: true });

    if (error) {
      throw new DatabaseError(
        'Failed to list carer availability',
        'DATABASE_ERROR',
        { details: error.message, userId }
      );
    }
    return (data ?? []) as CarerAvailability[];
  }

  /**
   * Upsert one weekday row on the unique `(user_id, weekday)` key
   * (`carer_availability_user_weekday_idx`). The PUT body always represents
   * exactly one weekday, so a single upsert call — rather than a
   * select-then-insert/update round trip — is both simpler and avoids a
   * check-then-act race between two concurrent PUTs for the same weekday.
   */
  async upsertForWeekday(
    userId: string,
    weekday: number,
    data: Omit<CreateCarerAvailabilityInput, 'weekday'>
  ): Promise<CarerAvailability> {
    const { data: upserted, error } = await supabaseService
      .from(this.table)
      .upsert(
        { ...data, user_id: userId, weekday },
        { onConflict: 'user_id,weekday' }
      )
      .select()
      .single();

    if (error) {
      throw new DatabaseError(
        'Failed to upsert carer availability',
        'DATABASE_ERROR',
        { details: error.message, userId, weekday }
      );
    }
    return upserted as CarerAvailability;
  }
}
