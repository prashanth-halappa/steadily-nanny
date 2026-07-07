/**
 * Widget repository — data access for the `widgets` table. Extends BaseRepository
 * for the standard CRUD and adds two domain queries. Uses the service-role
 * Supabase client, so ownership/authorization is enforced in the SERVICE layer,
 * never here.
 *
 * @module domains/widget/repositories/widgetRepository
 */
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';
import type { Widget } from '../types';

export class WidgetRepository extends BaseRepository<Widget> {
  constructor() {
    super('widgets'); // the Postgres table name
  }

  /** List a user's widgets, newest first. */
  async findByOwnerId(ownerId: string): Promise<Widget[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError(
        'Failed to list widgets by owner',
        'DATABASE_ERROR',
        { details: error.message, ownerId }
      );
    }
    return (data ?? []) as Widget[];
  }

  /**
   * Count widgets created at/after an ISO timestamp. Uses a head+exact count so
   * no rows are transferred — the digest job only needs the number.
   */
  async countCreatedSince(sinceIso: string): Promise<number> {
    const { count, error } = await supabaseService
      .from(this.table)
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sinceIso);

    if (error) {
      throw new DatabaseError(
        'Failed to count recent widgets',
        'DATABASE_ERROR',
        { details: error.message, sinceIso }
      );
    }
    return count ?? 0;
  }
}
