/**
 * @module tests/unit/migration107HolidayCountry.test
 * Pattern A — migration contract for
 * `107_household_country_and_custom_holidays.sql`, written BEFORE the
 * migration existed (045/050/068/079/080 discipline).
 *
 * REPO FILE ONLY. Never applied to any environment as part of this slice.
 * Apply via the Supabase MCP `apply_migration`, in order after 106 — never
 * `supabase db push` (version-scheme mismatch).
 *
 * TWO PIECES
 *   1. `households.country` — a shape-checked ISO-3166 alpha-2, default 'US'.
 *      The valid list is versioned in TypeScript, the same reasoning as
 *      `household_holidays.holiday_key` having no CHECK enum. Default 'US'
 *      (never device-derived) because every existing household already has
 *      11 US federal holiday rows seeded; a disagreeing default would orphan
 *      that data on migration day. No backfill for the same reason.
 *   2. `household_custom_holidays` — one named custom day per household, with
 *      a `dates` array rather than a row per date. The row existing IS the
 *      observance (no `observed` column); delete to opt out, which also
 *      removes the string. 052 posture: members-select, service-role writes.
 *
 * PRIVACY. A custom holiday name can disclose religion. Member-select-only,
 * service-role-write-only, and must never reach a payroll export.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '107_household_country_and_custom_holidays.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** Only the `--` comment lines — the documentation contract. */
const comments = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('107 — households.country', () => {
  it('adds the column idempotently as char(2) not null default US', () => {
    // Executable SQL is lowercased, so 'US' matches as 'us'. The assertion
    // string is the intended SQL, then folded the same way.
    expect(executable).toContain(
      "alter table public.households add column if not exists country char(2) not null default 'US' check (country ~ '^[A-Z]{2}$')".toLowerCase()
    );
  });

  it('is a SHAPE check, not an enum of country codes', () => {
    // Same reasoning as household_holidays.holiday_key: the valid list is
    // versioned in TypeScript. A CHECK enum here would mean a migration to
    // add a country.
    expect(executable).not.toContain('check (country in');
    expect(executable).not.toContain("country in ('us'");
    expect(executable).not.toContain("country in ('US'".toLowerCase());
  });

  it('backfills nothing — existing households already carry US federal rows', () => {
    expect(executable).not.toContain('update public.households');
    expect(executable).not.toContain('insert into public.households');
  });
});

describe('107 — household_custom_holidays', () => {
  it('creates the table idempotently, keyed on the household', () => {
    expect(executable).toContain(
      'create table if not exists public.household_custom_holidays'
    );
    expect(executable).toContain(
      'household_id uuid not null references public.households(id) on delete cascade'
    );
    expect(executable).toContain(
      'id uuid primary key default gen_random_uuid()'
    );
  });

  it('stores a trimmed name of 1–60 characters', () => {
    expect(executable).toContain(
      'name text not null check (char_length(btrim(name)) between 1 and 60)'
    );
  });

  it('stores dates as date[] not null, gated by cardinality not array_length', () => {
    // `date[] not null` is 010's `exdates` house style. cardinality(empty)
    // is 0, so the CHECK fails; array_length(empty, 1) is NULL, and a NULL
    // CHECK PASSES — which would let an empty array through.
    expect(executable).toContain('dates date[] not null');
    expect(executable).toContain('check (cardinality(dates) between 1 and 12)');
    expect(executable).not.toContain('array_length');
  });

  it('allows exactly one row per (household, name)', () => {
    expect(executable).toMatch(/unique\s*\(\s*household_id,\s*name\s*\)/);
  });

  it('has no observed column — the row existing is the observance', () => {
    expect(executable).not.toContain('observed boolean');
    expect(executable).not.toContain('observed ');
  });

  it('carries the house timestamp pair and the shared updated_at trigger', () => {
    expect(executable).toContain(
      'created_at timestamptz not null default now()'
    );
    expect(executable).toContain(
      'updated_at timestamptz not null default now()'
    );
    expect(executable).toContain('execute function public.set_updated_at()');
    expect(executable).toContain(
      'drop trigger if exists set_household_custom_holidays_updated_at'
    );
  });

  it('adds no extra index — the unique constraint already serves the query', () => {
    expect(executable).not.toContain('create index');
    expect(executable).not.toContain('create unique index');
  });

  it('backfills nothing', () => {
    expect(executable).not.toContain(
      'insert into public.household_custom_holidays'
    );
  });
});

describe('107 — RLS is 052’s select-only posture, not 080’s parent writes', () => {
  it('enables row level security', () => {
    expect(executable).toContain(
      'alter table public.household_custom_holidays enable row level security'
    );
  });

  it('lets members select, and nobody else', () => {
    expect(executable).toContain(
      'for select using (private.is_household_member(household_id))'
    );
  });

  it('has exactly one policy, dropped before create so db reset is re-runnable', () => {
    const drops = executable.match(/drop policy if exists/g) ?? [];
    const creates = executable.match(/create policy/g) ?? [];
    expect(drops.length).toBe(creates.length);
    expect(creates.length).toBe(1);
  });

  it('asserts the ABSENCE of any insert/update/delete policy on the new table', () => {
    // 080 still has parent write policies because it predates 052. This table
    // must not. `for update` would be a policy; the trigger is `before update`.
    expect(executable).not.toContain('for insert');
    expect(executable).not.toContain('for update');
    expect(executable).not.toContain('for delete');
    expect(executable).not.toContain('is_household_parent');
  });
});

describe('107 — the documentation contract', () => {
  it('explains why a dates array rather than a row per date', () => {
    expect(comments).toContain('dates');
    expect(comments).toContain('row per date');
  });

  it('explains why there is no observed column', () => {
    expect(comments).toContain('observed');
    expect(comments).toContain('observance');
  });

  it('explains why country has no enum CHECK', () => {
    expect(comments).toContain('enum');
    expect(comments).toContain('typescript');
  });

  it('carries a PRIVACY note: religion, select-only, never a payroll export', () => {
    expect(comments).toContain('privacy');
    expect(comments).toContain('religion');
    expect(comments).toContain('payroll');
  });
});
