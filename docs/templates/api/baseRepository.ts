/**
 * Abstract base repository implementing common CRUD operations on D1 (Drizzle).
 * Mirrors apps/api/src/shared/repositories/baseRepository.ts (trimmed).
 *
 * The constructor takes the Drizzle TABLE OBJECT (not a name string); the second
 * generic keeps column typing for subclass queries on `this.table`:
 *
 *   import { widgets } from '../../../db/schema';
 *   export class WidgetRepository extends BaseRepository<Widget, typeof widgets> {
 *     constructor() { super(widgets); }
 *   }
 *
 * There is no RLS on D1: every query runs with full access, so ownership is
 * enforced in the SERVICE layer. Every failure is a `DatabaseError` whose
 * `cause` is the driver error, so `mapDbError(err)` (src/db/errors.ts) works on it.
 */
import { and, eq, getTableColumns, getTableName } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../../db/client';
import { mapDbError } from '../../db/errors';
import { DatabaseError } from '../../errors';

/** Any Drizzle table with an `id` primary-key column. */
export type TableWithId = SQLiteTable & { id: SQLiteColumn };

export abstract class BaseRepository<T, TTable extends TableWithId = TableWithId> {
  protected table: TTable;
  protected tableName: string;

  constructor(table: TTable) {
    this.table = table;
    this.tableName = getTableName(table);
  }

  protected dbError(message: string, err: unknown, metadata: Record<string, unknown>) {
    const error = new DatabaseError(`${message} ${this.tableName}`, 'DATABASE_ERROR', {
      ...metadata,
      details: err instanceof Error ? err.message : String(err),
      ...(mapDbError(err) ?? {}),
    });
    error.cause = err;
    return error;
  }

  async findById(id: string): Promise<T | null> {
    try {
      const rows = await db
        .select()
        .from(this.table as SQLiteTable)
        .where(eq(this.table.id, id))
        .limit(1);
      return (rows[0] as T | undefined) ?? null;
    } catch (err) {
      throw this.dbError('Failed to find by id', err, { id, operation: 'findById' });
    }
  }

  /** All filters AND-ed; no filters = no WHERE. */
  async findAll(filters?: Record<string, unknown>): Promise<T[]> {
    try {
      const columns = getTableColumns(this.table);
      const conditions = Object.entries(filters ?? {}).map(([key, value]) => {
        const column = columns[key];
        if (!column) throw new Error(`Unknown column ${key}`);
        return eq(column, value);
      });
      const rows = await db
        .select()
        .from(this.table as SQLiteTable)
        .where(and(...conditions));
      return rows as T[];
    } catch (err) {
      throw this.dbError('Failed to list', err, { operation: 'findAll' });
    }
  }

  async create(data: Partial<T>): Promise<T> {
    try {
      const rows = await db
        .insert(this.table as SQLiteTable)
        .values(data as Record<string, unknown>)
        .returning();
      return rows[0] as T;
    } catch (err) {
      throw this.dbError('Failed to create', err, { operation: 'create' });
    }
  }

  /** Updating a missing id throws (zero rows is an error, not null). */
  async update(id: string, data: Partial<T>): Promise<T> {
    let rows: unknown[];
    try {
      rows = await db
        .update(this.table as SQLiteTable)
        .set(data as Record<string, unknown>)
        .where(eq(this.table.id, id))
        .returning();
    } catch (err) {
      throw this.dbError('Failed to update', err, { id, operation: 'update' });
    }
    if (!rows[0])
      throw this.dbError('Failed to update', new Error('No row with that id'), {
        id,
        operation: 'update',
      });
    return rows[0] as T;
  }

  async delete(id: string): Promise<void> {
    try {
      await db.delete(this.table as SQLiteTable).where(eq(this.table.id, id));
    } catch (err) {
      throw this.dbError('Failed to delete', err, { id, operation: 'delete' });
    }
  }
}
