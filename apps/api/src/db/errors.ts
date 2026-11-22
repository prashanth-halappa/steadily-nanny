/**
 * Classify a SQLite / D1 constraint failure — the replacement for matching
 * Postgres SQLSTATEs (`23505` unique, `23P01` exclusion, `23503` FK, `23514`
 * check) on a supabase-js error.
 *
 * Works on a raw bun:sqlite error, a D1 error (`D1_ERROR: … : SQLITE_CONSTRAINT`)
 * and a drizzle `DrizzleQueryError` (whose `cause` holds the driver error) —
 * it walks the `cause` chain and reads the message.
 *
 * `constraint` is the ORIGINAL Postgres constraint/index name wherever it can
 * be recovered, so callers keep matching by name (`terms_proposals_open_unique_idx`,
 * `shifts_carer_window_excl`, …):
 * - SQLite names an expression index (`UNIQUE constraint failed: index 'x'`);
 * - for a plain-column unique it names only the columns, so we map
 *   `table.col, …` back to the index / unique / primary key declared in the
 *   Drizzle schema (ambiguous column sets map to no name);
 * - CHECK messages carry the CHECK's name; overlap triggers raise
 *   `overlap:<name>` (migrations/0001_triggers.sql).
 *
 * @module db/errors
 */
import { Column, is, type SQL } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export type DbErrorKind = 'unique' | 'foreign_key' | 'check' | 'overlap';

export interface DbErrorInfo {
  kind: DbErrorKind;
  constraint?: string;
}

const isTable = (v: unknown): v is SQLiteTable =>
  typeof v === 'object' &&
  v !== null &&
  Symbol.for('drizzle:IsDrizzleTable') in v;

/** `table.colA, table.colB` -> constraint name, built once from the schema. */
const uniqueByColumns: Map<string, string | undefined> = (() => {
  const map = new Map<string, string | undefined>();
  const add = (table: string, cols: (Column | SQL)[], name: string) => {
    if (!cols.every(c => is(c, Column))) return; // expression index: SQLite names it itself
    const key = (cols as Column[]).map(c => `${table}.${c.name}`).join(', ');
    map.set(key, map.has(key) ? undefined : name); // ambiguous -> no name
  };
  for (const t of Object.values(schema)) {
    if (!isTable(t)) continue;
    const cfg = getTableConfig(t);
    for (const c of cfg.columns) {
      if (c.primary) add(cfg.name, [c], `${cfg.name}_pkey`);
      if (c.isUnique && c.uniqueName) add(cfg.name, [c], c.uniqueName);
    }
    for (const pk of cfg.primaryKeys) add(cfg.name, pk.columns, pk.getName());
    for (const u of cfg.uniqueConstraints)
      add(cfg.name, u.columns, u.getName() ?? '');
    for (const i of cfg.indexes)
      if (i.config.unique) add(cfg.name, i.config.columns, i.config.name);
  }
  return map;
})();

function messages(err: unknown): string[] {
  const out: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur instanceof Error) out.push(cur.message);
    else if (typeof cur === 'string') out.push(cur);
    cur =
      typeof cur === 'object' && cur !== null && 'cause' in cur
        ? cur.cause
        : undefined;
  }
  return out;
}

export function mapDbError(err: unknown): DbErrorInfo | null {
  for (const msg of messages(err)) {
    const overlap = /overlap:(\w+)/.exec(msg);
    if (overlap) return { kind: 'overlap', constraint: overlap[1] };

    const unique =
      /UNIQUE constraint failed: (index '(\w+)'|[\w.]+(?:, [\w.]+)*)/.exec(msg);
    if (unique) {
      const constraint = unique[2] ?? uniqueByColumns.get(unique[1] ?? '');
      return constraint ? { kind: 'unique', constraint } : { kind: 'unique' };
    }

    if (msg.includes('FOREIGN KEY constraint failed'))
      return { kind: 'foreign_key' };

    const chk = /CHECK constraint failed: (\w+)/.exec(msg);
    if (chk) return { kind: 'check', constraint: chk[1] };
  }
  return null;
}
