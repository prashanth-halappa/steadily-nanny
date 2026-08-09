/**
 * @module tests/unit/migration072RemoveAskOther.test
 * Pins migration 072 against the shared-types approval_mode const-map.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUSEHOLD_APPROVAL_MODES } from '@steadily-nanny/shared-types/schemas/household.schema';

const migrationPath = join(
  import.meta.dir,
  '../../../../supabase/migrations/072_remove_ask_other.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

describe('072_remove_ask_other.sql', () => {
  it('withdraws in-flight pending co_parent_approvals', () => {
    expect(sql).toContain("status = 'withdrawn'");
    expect(sql).toContain("where status = 'pending'");
  });

  it('migrates ask_other households to either', () => {
    expect(sql).toContain("set approval_mode = 'either'");
    expect(sql).toContain("where approval_mode = 'ask_other'");
  });

  it('CHECK constraint matches HOUSEHOLD_APPROVAL_MODES', () => {
    const values = Object.values(HOUSEHOLD_APPROVAL_MODES).sort();
    expect(sql).toContain("check (approval_mode in ('either', 'owner_only'))");
    expect(values).toEqual(['either', 'owner_only']);
  });

  it('drops approval_timeout_minutes', () => {
    expect(sql).toContain('drop column approval_timeout_minutes');
  });
});
