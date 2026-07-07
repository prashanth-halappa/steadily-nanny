/**
 * Repository skeleton — data access for the `<feature>` domain.
 * Lives at: apps/api/src/domains/<feature>/repositories/<feature>Repository.ts
 *
 * Extends BaseRepository for the standard CRUD (findById/findAll/create/update/delete)
 * and adds domain-specific queries. Uses the service-role Supabase client, so
 * ownership/authorization is enforced in the SERVICE layer, never here.
 *
 * Replace `Widget` / `widgets` with your entity and table name.
 */

import type { Widget } from '@yourapp/shared-types/schemas/widget.schema';
import { supabaseService } from '../../../config/supabase';
import { DatabaseError } from '../../../errors';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class WidgetRepository extends BaseRepository<Widget> {
  constructor() {
    super('widgets'); // the Postgres table name
  }

  /** Domain-specific query the base class doesn't provide. */
  async findByOwnerId(ownerId: string): Promise<Widget[]> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new DatabaseError('Failed to list widgets by owner', 'DATABASE_ERROR', {
        details: error.message,
        ownerId,
      });
    }
    return data ?? [];
  }
}
