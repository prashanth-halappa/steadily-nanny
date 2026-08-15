/**
 * @module tests/unit/migration080Holidays.test
 * Pattern A — migration contract for `080_holidays.sql`, written BEFORE the
 * migration existed (045/050/068/079 discipline).
 *
 * REPO FILE ONLY. Never applied to any environment as part of Phase 3 slice
 * 3-E4 (playbook §3). Phase 6 applies the rehearsed chain via the Supabase
 * MCP, in order, never `supabase db push`.
 *
 * WHY THIS MIGRATION EXISTS (§5 D-12, gap T6). A paid holiday was only
 * fakeable as PTO, and a worked holiday paid the ordinary rate with no way to
 * say otherwise. D-12: "household list seeded from the federal set, per-family
 * toggles, optional worked-holiday premium multiplier", owner note *"all these
 * should be configurable by the parent."*
 *
 * TWO PIECES, TWO HOMES, AND THE SPEC PICKS BOTH
 * (`docs/design/screens-pay-terms.md` §3 and §4.3):
 *   - The CALENDAR is the family's — one list, every carer. New table
 *     `household_holidays`, one row per (household, holiday_key).
 *   - The PREMIUM is a term of one carer's employment — a second carer may
 *     have agreed a different one. New column
 *     `pay_arrangements.worked_holiday_multiplier`, null = the normal rate.
 * Spec §4.3, verbatim: "The list is household-level; the premium multiplier is
 * on the arrangement."
 *
 * WHY A KEY AND NOT A DATE. Six of the eleven federal holidays have no fixed
 * date; "the third Monday in January" is a rule. Storing dates would be eleven
 * rows a year, per household, forever — and a second copy of a rule that
 * already lives in `packages/shared-types/src/usFederalHolidays.ts`, free to
 * disagree with it. The row stores the toggle; the date is resolved at
 * pricing time for the year the week falls in.
 *
 * WHY NO SEED TRIGGER AND NO NEW FUNCTION. The federal KEY LIST already
 * exists in TypeScript (the engine and the terms screen both need it there).
 * A SQL trigger that seeded new households would need a second copy of that
 * list inside this file, and two lists of eleven keys are two lists that
 * eventually disagree. The seed is therefore one insert in
 * `householdCommandService.create`, off the one list. That also means this
 * migration adds NO function, so there is nothing for GOLDEN-FIXES #16's
 * `revoke ... from public` to apply to — the asserted-absence test below
 * exists so that stays a decision rather than an oversight.
 *
 * ABSENT MEANS NOT OBSERVED. A household with no rows observes no holidays.
 * That is the null-is-an-explicit-no rule (§2.9) applied to a row set, and it
 * is the safe direction: reading absence as "observed" would have every
 * household that predates this migration silently start paying a premium on
 * eleven dates nobody chose. No backfill (§5 D-9 — the app is pre-launch).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '080_holidays.sql';

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

describe('080 — the household holiday calendar', () => {
  it('creates the table idempotently, keyed on the household', () => {
    expect(executable).toContain(
      'create table if not exists public.household_holidays'
    );
    expect(executable).toContain(
      'household_id uuid not null references public.households(id) on delete cascade'
    );
  });

  it('stores a KEY, never a date — the date is a rule, resolved per year', () => {
    expect(executable).toContain('holiday_key text not null');
    // A `date` column here would be the rule copied into storage. If this
    // assertion ever fails, read `usFederalHolidays.ts`'s header first.
    expect(executable).not.toContain('holiday_date');
    expect(executable).not.toContain('observed_date');
  });

  it('makes the toggle a not-null boolean defaulting to observed', () => {
    // The row EXISTS only because somebody stated something about the day, so
    // the flag is never null: `true` = observed, `false` = this family opted
    // it out. Absence of the row is the third state, and it means "nothing
    // agreed" — see the module header.
    expect(executable).toContain('observed boolean not null default true');
  });

  it('allows exactly one row per (household, holiday_key)', () => {
    // Two rows for the same day would be two contradictory answers to "does
    // this family observe it", and the engine would have to pick one.
    expect(executable).toMatch(
      /unique\s*\(\s*household_id,\s*holiday_key\s*\)/
    );
  });

  it('carries the house timestamp pair and the shared updated_at trigger', () => {
    expect(executable).toContain(
      'created_at timestamptz not null default now()'
    );
    expect(executable).toContain(
      'updated_at timestamptz not null default now()'
    );
    expect(executable).toContain('execute function public.set_updated_at()');
    // Re-runnable, like every trigger in this repo (035's shape).
    expect(executable).toContain(
      'drop trigger if exists set_household_holidays_updated_at'
    );
  });

  it('enables RLS with 035’s member-read / parent-write shape', () => {
    expect(executable).toContain(
      'alter table public.household_holidays enable row level security'
    );
    // Carers read: what the family observes is a term of her employment and
    // she is entitled to see it (spec §2, "both people read the same one").
    expect(executable).toContain(
      'for select using (private.is_household_member(household_id))'
    );
    expect(executable).toContain(
      'for insert with check (private.is_household_parent(household_id))'
    );
    expect(executable).toContain(
      'for update using (private.is_household_parent(household_id))'
    );
  });

  it('drops each policy before creating it — re-runnable house pattern', () => {
    const drops = executable.match(/drop policy if exists/g) ?? [];
    const creates = executable.match(/create policy/g) ?? [];
    expect(drops.length).toBe(creates.length);
    expect(creates.length).toBeGreaterThanOrEqual(3);
  });

  it('documents the table', () => {
    expect(executable).toContain('comment on table public.household_holidays');
  });

  it('adds NO function, so there is no grant surface to get wrong', () => {
    // GOLDEN-FIXES #16 requires `revoke ... from public` on every new
    // function, because `anon`/`authenticated` inherit execute from PUBLIC.
    // The cheapest way to satisfy it is to add no function — see the module
    // header for why the seed lives in TypeScript instead.
    expect(executable).not.toContain('create or replace function');
    expect(executable).not.toContain('create function');
  });

  it('backfills nothing — absence means "nothing agreed" (§5 D-9)', () => {
    expect(executable).not.toContain('insert into public.household_holidays');
    expect(executable).not.toContain('update public.households');
  });
});

describe('080 — pay_arrangements.worked_holiday_multiplier', () => {
  it('adds the column idempotently, nullable, no default', () => {
    expect(executable).toContain(
      'alter table public.pay_arrangements add column if not exists worked_holiday_multiplier numeric(3, 2)'
    );
    // Null = "a worked holiday pays the normal rate" (spec §4.3's own words).
    // A default of 1.5 would promise every family a premium nobody agreed to
    // — the same D-7 liability the 078 tiers refuse a default for.
    expect(executable).not.toContain(
      'worked_holiday_multiplier numeric(3, 2) not null'
    );
    expect(executable).not.toContain(
      'worked_holiday_multiplier numeric(3, 2) default'
    );
  });

  it('floors it at 1 — a "premium" below 1 pays LESS for working a holiday', () => {
    expect(executable).toContain(
      'add constraint pay_arrangements_worked_holiday_multiplier_min check (worked_holiday_multiplier >= 1)'
    );
    expect(executable).toContain(
      'drop constraint if exists pay_arrangements_worked_holiday_multiplier_min'
    );
  });

  it('adds no policy to pay_arrangements — 041’s RLS already scopes the row', () => {
    expect(executable).not.toContain('on public.pay_arrangements for select');
    expect(executable).not.toContain('on public.pay_arrangements for update');
  });
});

describe('080 — the documentation contract', () => {
  it('names the decisions it implements', () => {
    expect(comments).toContain('d-12');
    expect(comments).toContain('d-9');
  });

  it('says out loud that the calendar is household-level and the premium is not', () => {
    expect(comments).toContain('household-level');
    expect(comments).toContain('arrangement');
  });

  // Was "repo file only" until Phase 6 actually applied this migration and
  // rewrote the header without touching the assertion. The header is the
  // source of truth about a migration's own application state; what has to
  // stay documented now is that it IS applied and must not be run again.
  it('says the file is applied to prod and must not be re-applied', () => {
    expect(comments).toContain('applied to prod');
    expect(comments).toContain('do not re-apply');
  });
});
