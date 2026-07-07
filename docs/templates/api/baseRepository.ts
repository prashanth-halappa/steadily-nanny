/**
 * Abstract base repository implementing common CRUD operations against Supabase.
 *
 * All reads/writes go through the SERVICE-ROLE client (`supabaseService`), which
 * bypasses Row-Level Security — this code is server-side only and enforces
 * ownership in the service layer, never by exposing the service key to clients.
 *
 * Domain repositories extend this and add table-specific queries:
 *
 *   export class WidgetRepository extends BaseRepository<Widget> {
 *     constructor() { super('widgets'); }
 *     async findByOwnerId(ownerId: string): Promise<Widget[]> {
 *       const { data, error } = await supabaseService
 *         .from(this.table).select('*').eq('owner_id', ownerId);
 *       if (error) throw new DatabaseError('Failed to list widgets', 'DATABASE_ERROR', { ownerId });
 *       return data ?? [];
 *     }
 *   }
 */
import { supabaseService } from '../../config/supabase';
import { DatabaseError } from '../../errors';

export abstract class BaseRepository<T> {
  protected table: string;

  constructor(tableName: string) {
    this.table = tableName;
  }

  /** Find a record by its ID. Returns null if not found. */
  async findById(id: string): Promise<T | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error)
      throw new DatabaseError(`Failed to find ${this.table} by id`, 'DATABASE_ERROR', {
        id,
        operation: 'findById',
      });
    return data;
  }

  /** Find all records, optionally filtered by equality on key/value pairs. */
  async findAll(filters?: Record<string, unknown>): Promise<T[]> {
    let query = supabaseService.from(this.table).select('*');
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }
    }
    const { data, error } = await query;
    if (error)
      throw new DatabaseError(`Failed to list ${this.table}`, 'DATABASE_ERROR', {
        operation: 'findAll',
      });
    return data ?? [];
  }

  /** Create a new record and return it. */
  async create(data: Partial<T>): Promise<T> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      // biome-ignore lint/suspicious/noExplicitAny: generic base class; callers provide type safety
      .insert(data as any)
      .select()
      .single();

    if (error)
      throw new DatabaseError(`Failed to create ${this.table}`, 'DATABASE_ERROR', {
        operation: 'create',
        details: error.message,
        code: error.code,
      });
    return created;
  }

  /** Update a record by ID and return the updated row. */
  async update(id: string, data: Partial<T>): Promise<T> {
    const { data: updated, error } = await supabaseService
      .from(this.table)
      // biome-ignore lint/suspicious/noExplicitAny: generic base class; callers provide type safety
      .update(data as any)
      .eq('id', id)
      .select()
      .single();

    if (error)
      throw new DatabaseError(`Failed to update ${this.table}`, 'DATABASE_ERROR', {
        id,
        operation: 'update',
      });
    return updated;
  }

  /** Delete a record by ID. */
  async delete(id: string): Promise<void> {
    const { error } = await supabaseService.from(this.table).delete().eq('id', id);

    if (error)
      throw new DatabaseError(`Failed to delete ${this.table}`, 'DATABASE_ERROR', {
        id,
        operation: 'delete',
      });
  }
}
