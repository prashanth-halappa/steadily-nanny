/**
 * Shared column defaults for the D1 schema.
 *
 * `NOW` is the SQLite spelling of Postgres `now()` for a timestamptz column
 * stored as ISO-8601 UTC text. It produces exactly the shape of
 * `new Date().toISOString()` (`2026-11-22T10:00:00.123Z`), so rows written by
 * the database and rows written by the app compare and sort identically as
 * text. App code that writes an instant MUST use `toISOString()` too — text
 * comparison (and the window unique indexes on shifts) assume that one format.
 *
 * @module db/schema/columns
 */
import { sql } from 'drizzle-orm';

export const NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
