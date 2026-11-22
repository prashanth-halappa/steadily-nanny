/**
 * Recognising the shift write guards by NAME (audit S4a), plus the two tiny
 * SQL helpers the shift repositories share on D1.
 *
 * `shifts_carer_window_excl` was migration 104's exclusion constraint; on D1
 * it is a trigger raising `overlap:shifts_carer_window_excl`, which
 * `mapDbError` classifies as `{ kind: 'overlap' }`. The window-unique indexes
 * (059/062) surface as `{ kind: 'unique', constraint }`.
 *
 * MATCHED ON THE CONSTRAINT NAME, never the bare kind: `shifts` carries other
 * constraints, and mistranslating one of those would tell a parent about a
 * double-booking that is not there.
 *
 * @module domains/shift/utils/carerWindowOverlap
 */
import { getTableColumns, is, SQL, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../../../db/client';
import { mapDbError } from '../../../db/errors';

/** Migration 104's guard — the name the overlap is matched on. */
export const CARER_WINDOW_EXCLUSION = 'shifts_carer_window_excl';
/** Migration 059's partial unique index on live extra shifts. */
export const EXTRA_WINDOW_UNIQUE_INDEX = 'shifts_extra_window_unique';

export function isCarerWindowOverlap(err: unknown): boolean {
  const mapped = mapDbError(err);
  return (
    mapped?.kind === 'overlap' && mapped.constraint === CARER_WINDOW_EXCLUSION
  );
}

export function isUniqueViolationOn(err: unknown, constraint: string): boolean {
  const mapped = mapDbError(err);
  return mapped?.kind === 'unique' && mapped.constraint === constraint;
}

/**
 * Canonical instant text. Instants are compared as TEXT on D1, so a
 * `+00:00`-suffixed or ms-less client value must be rewritten into
 * `toISOString()` form before it is stored or compared (MIGRATION-NOTES §1).
 * Unparseable input passes through untouched for the CHECKs to refuse.
 */
export function isoInstant(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

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
