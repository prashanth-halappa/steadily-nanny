/**
 * Gated insert helper shared by repositories that need write-time guards
 * inside a D1 `db.batch`.
 *
 * @module db/insertIf
 */
import { getTableColumns, is, SQL, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from './client';

/**
 * `INSERT INTO <table> SELECT <values> WHERE <guard>` — a gated insert that
 * `db.batch` can carry. (A parameterised `db.run(sql)` crashes inside a D1
 * batch on drizzle 0.45: its raw query has no prepared `stmt` to bind.)
 *
 * Drizzle's insert-select writes EVERY column in table order, so columns
 * absent from `row` get their schema default — `$defaultFn` (ids) or the SQL
 * default (`created_at`) — and otherwise NULL.
 */
export function insertIf<TTable extends SQLiteTable>(
  table: TTable,
  row: Record<string, string | number | null>,
  guard: SQL
) {
  const values = Object.entries(getTableColumns(table))
    .filter(([, col]) => !col.generated)
    .map(([key, col]) => {
      if (key in row) return sql`${row[key] ?? null}`;
      if (col.defaultFn) return sql`${col.defaultFn() as string}`;
      if (is(col.default, SQL)) return sql`(${col.default})`;
      if (col.default !== undefined) return sql`${col.default as string}`;
      return sql`NULL`;
    });
  return db
    .insert(table)
    .select(sql`SELECT ${sql.join(values, sql`, `)} WHERE ${guard}`);
}
