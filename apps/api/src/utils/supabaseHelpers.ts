/**
 * Supabase relation unwrap helper.
 *
 * PostgREST sometimes returns a related record as a single-element array instead
 * of a plain object (depending on join cardinality). This normalizes it.
 *
 * @module utils/supabaseHelpers
 */

/**
 * Unwrap a relation value that may arrive as `T`, `T[]`, `null`, or `undefined`.
 * - `null` / `undefined` → `undefined`
 * - `[]` → `undefined`
 * - `[item]` → first element
 * - plain object / primitive → passed through
 */
export function unwrapRelation<T>(
  value: T | T[] | undefined | null
): T | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? (value[0] as T | undefined) : value;
}
