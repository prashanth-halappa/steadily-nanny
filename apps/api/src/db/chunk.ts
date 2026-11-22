/**
 * D1 caps a statement at 100 bound parameters, so `IN (...)` lists and
 * multi-row inserts are split. `size` is items per statement: 90 for an id
 * list (leaves room for the other filters), or `floor(90 / columns)` for rows.
 *
 * @module domains/schedule/repositories/chunk
 */
export function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** `db.batch` takes a non-empty tuple; callers have already returned early on empty input. */
export function nonEmpty<T>(items: T[]): [T, ...T[]] {
  const [first, ...rest] = items;
  if (first === undefined)
    throw new Error('db.batch needs at least one statement');
  return [first, ...rest];
}
