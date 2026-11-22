/**
 * Repository skeleton — data access for the `<feature>` domain.
 * Lives at: apps/api/src/domains/<feature>/repositories/<feature>Repository.ts
 *
 * Extends BaseRepository for the standard CRUD (findById/findAll/create/update/delete)
 * and adds domain-specific Drizzle queries. The table is defined in
 * apps/api/src/db/schema/<feature>.ts and re-exported from `db/schema`.
 * D1 has no RLS, so ownership/authorization is enforced in the SERVICE layer,
 * never here.
 *
 * Replace `Widget` / `widgets` with your entity and table.
 */

import type { Widget } from '@steadily-nanny/shared-types/schemas/widget.schema';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { widgets } from '../../../db/schema';
import { BaseRepository } from '../../../shared/repositories/baseRepository';

export class WidgetRepository extends BaseRepository<Widget, typeof widgets> {
  constructor() {
    super(widgets); // the Drizzle table object
  }

  /** Domain-specific query the base class doesn't provide. */
  async findByOwnerId(ownerId: string): Promise<Widget[]> {
    try {
      const rows = await db
        .select()
        .from(this.table)
        .where(eq(this.table.owner_id, ownerId))
        .orderBy(desc(this.table.created_at));
      return rows as Widget[];
    } catch (err) {
      throw this.dbError('Failed to list by owner', err, { ownerId });
    }
  }
}
