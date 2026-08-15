/**
 * @module tests/unit/migration095HolidayHours.test
 * Pattern A — migration contract for `095_pay_arrangement_holiday_hours.sql`,
 * written BEFORE the migration existed (045/050/068/079/080 discipline).
 *
 * REPO FILE ONLY. Never applied to any environment as part of Phase 3 slice
 * 3-E5 (playbook §3). Phase 6 applies the rehearsed chain via the Supabase
 * MCP, in order, never `supabase db push`.
 *
 * WHY THIS MIGRATION EXISTS (§5 D-53). 080 gave the holidays group half a
 * contract: it says what hours WORKED on an observed holiday pay
 * (`worked_holiday_multiplier`), and says nothing at all about the far more
 * common case — the family observes a holiday, nobody works it, and the nanny
 * is either paid for the day or she isn't. 3-E4 parked that as an open
 * question rather than inferring an answer; D-53 answers it with an explicit
 * per-household TERM instead: a fixed hour credit, priced for each observed
 * holiday nobody worked.
 *
 * ONE COLUMN, ON THE ARRANGEMENT, for exactly the reason 080 put the premium
 * there: the CALENDAR is the family's (one list, every carer) but what a
 * holiday is worth is a term of THIS carer's employment, and a household with
 * two carers may have agreed different ones.
 *
 * NULL = NO CREDIT, and that is today's behaviour unchanged (§2.9's
 * null-is-an-explicit-no). No default and no backfill: a default of 8h would
 * hand every existing family a paid-holiday term nobody agreed to, which is
 * the exact D-7 liability the preset posture exists to avoid, and §5 D-9
 * wipes every account before store release anyway.
 *
 * `> 0`, NOT `>= 0`. Null already spells "no credit". A stored zero would be
 * a second spelling of the same agreement, and the engine would then have to
 * guess which of the two a parent meant — so Postgres refuses it (§2.9:
 * refuse, never clamp; the database is the last place that can still say no).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '095_pay_arrangement_holiday_hours.sql';

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

describe('095 — pay_arrangements.holiday_hours_minutes', () => {
  it('adds the column idempotently, nullable, integer, no default', () => {
    expect(executable).toContain(
      'alter table public.pay_arrangements add column if not exists holiday_hours_minutes integer'
    );
    expect(executable).not.toContain('holiday_hours_minutes integer not null');
    expect(executable).not.toContain('holiday_hours_minutes integer default');
  });

  it('stores MINUTES, never hours — the unit every other duration column holds', () => {
    // An hours-valued column would need a converter somewhere between the
    // form and the engine, and that converter is where a factor-of-60 defect
    // lives. `numeric` here would also be a float in a money path.
    expect(executable).not.toContain('holiday_hours numeric');
    expect(executable).not.toContain('holiday_hours_hours');
  });

  it('refuses zero and negatives — null already says "no credit"', () => {
    expect(executable).toContain(
      'add constraint pay_arrangements_holiday_hours_minutes_positive check (holiday_hours_minutes > 0)'
    );
    // 080/078's house pattern: drop-if-exists then add, so the migration is
    // re-runnable and `db reset` never dies on the second pass.
    expect(executable).toContain(
      'drop constraint if exists pay_arrangements_holiday_hours_minutes_positive'
    );
  });

  it('adds no policy to pay_arrangements — 041’s RLS already scopes the row', () => {
    expect(executable).not.toContain('on public.pay_arrangements for select');
    expect(executable).not.toContain('on public.pay_arrangements for update');
    expect(executable).not.toContain('enable row level security');
  });

  it('creates no table, no function, and no trigger', () => {
    // One column. A function would need GOLDEN-FIXES #16's `revoke ... from
    // public`; there is deliberately nothing here for it to apply to.
    expect(executable).not.toContain('create table');
    expect(executable).not.toContain('create or replace function');
    expect(executable).not.toContain('create trigger');
  });

  it('backfills nothing — no existing family gains a term it never agreed', () => {
    expect(executable).not.toContain('update public.pay_arrangements');
    expect(executable).not.toContain('insert into public.pay_arrangements');
  });

  it('comments the column, so the null meaning survives outside this file', () => {
    expect(executable).toContain(
      'comment on column public.pay_arrangements.holiday_hours_minutes'
    );
  });
});

describe('095 — the documentation contract', () => {
  it('names the decisions it implements', () => {
    expect(comments).toContain('d-53');
    expect(comments).toContain('d-12');
  });

  it('states that null means no credit, and that this is unchanged behaviour', () => {
    expect(comments).toContain('null');
    expect(comments).toContain('no credit');
  });

  // Was "repo file only" until Phase 6 applied it and rewrote the header
  // without touching the assertion. The header is the source of truth about a
  // migration's own application state; what has to stay documented now is
  // that it IS applied, when, and that it must not be run again.
  it('says out loud that it was applied to prod in Phase 6 and must not be re-applied', () => {
    expect(comments).toContain('applied to prod');
    expect(comments).toContain('phase 6');
    expect(comments).toContain('do not re-apply');
  });
});
