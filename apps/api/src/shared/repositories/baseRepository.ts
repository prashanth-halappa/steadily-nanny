/**
 * Abstract base repository implementing common CRUD operations.
 * Uses parameter injection for testability — services can pass a mock repo.
 */
import { supabaseService } from '../../config/supabase';
import { DatabaseError } from '../../errors';

export abstract class BaseRepository<T> {
  protected table: string;

  constructor(tableName: string) {
    this.table = tableName;
  }

  async findById(id: string): Promise<T | null> {
    const { data, error } = await supabaseService
      .from(this.table)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error)
      throw new DatabaseError(
        `Failed to find ${this.table} by id`,
        'DATABASE_ERROR',
        {
          id,
          operation: 'findById',
        }
      );
    return data as T | null;
  }

  async findAll(filters?: Record<string, unknown>): Promise<T[]> {
    let query = supabaseService.from(this.table).select('*');
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }
    }
    const { data, error } = await query;
    if (error)
      throw new DatabaseError(
        `Failed to list ${this.table}`,
        'DATABASE_ERROR',
        {
          operation: 'findAll',
        }
      );
    return (data ?? []) as T[];
  }

  async create(data: Partial<T>): Promise<T> {
    const { data: created, error } = await supabaseService
      .from(this.table)
      .insert(data as Record<string, unknown>)
      .select()
      .single();

    if (error)
      throw new DatabaseError(
        `Failed to create ${this.table}`,
        'DATABASE_ERROR',
        {
          operation: 'create',
          details: error.message,
          code: error.code,
        }
      );
    return created as T;
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const { data: updated, error } = await supabaseService
      .from(this.table)
      .update(data as Record<string, unknown>)
      .eq('id', id)
      .select()
      .single();

    if (error)
      throw new DatabaseError(
        `Failed to update ${this.table}`,
        'DATABASE_ERROR',
        {
          id,
          operation: 'update',
        }
      );
    return updated as T;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabaseService
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error)
      throw new DatabaseError(
        `Failed to delete ${this.table}`,
        'DATABASE_ERROR',
        {
          id,
          operation: 'delete',
        }
      );
  }
}
