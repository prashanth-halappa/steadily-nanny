/**
 * @module tests/unit/domains/shift/migrations/shiftEventsKeyedUnique.test
 * Pattern A — migration contract for shift_events keyed uniqueness (G7).
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const migrationPath = join(
  import.meta.dir,
  '../../../../../../../supabase/migrations/025_shift_events_keyed_unique.sql'
);

describe('025_shift_events_keyed_unique.sql', () => {
  it('deletes duplicates before creating the partial unique index', async () => {
    const sql = await Bun.file(migrationPath).text();
    const deleteIdx = sql.toLowerCase().indexOf('delete');
    const createIdx = sql.toLowerCase().indexOf('create unique index');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThan(deleteIdx);
  });

  it('keeps the oldest row per keyed partition (created_at asc, id asc)', async () => {
    const sql = await Bun.file(migrationPath).text();
    expect(sql).toContain('row_number() over (');
    expect(sql).toContain(
      "partition by household_id, local_date, event_type, (payload->>'key')"
    );
    expect(sql).toContain('order by created_at asc, id asc');
    expect(sql).toContain('rn > 1');
  });

  it('creates a partial unique index on payload key with is not null predicate', async () => {
    const sql = await Bun.file(migrationPath).text();
    expect(sql).toContain('shift_events_keyed_unique_idx');
    expect(sql).toContain(
      "on public.shift_events (household_id, local_date, event_type, (payload->>'key'))"
    );
    expect(sql).toContain("where (payload->>'key') is not null");
    expect(sql).not.toContain("payload ? 'key'");
    expect(sql.toLowerCase()).not.toContain('concurrently');
  });
});
