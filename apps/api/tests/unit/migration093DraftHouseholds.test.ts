/**
 * @module tests/unit/migration093DraftHouseholds.test
 * Pattern A — migration contract for `093_draft_households.sql`
 * (3-O, D-34 / D-36 / D-49 / D-51).
 *
 * Three invariants live in this file, and each of them is the kind that fails
 * SILENTLY if a later refactor breaks it — which is exactly why they are
 * pinned as text rather than trusted to review.
 *
 * 1. THE CRON INVARIANT. `docs/design/screens-onboarding-terms-proposal.md`
 *    §12 says a draft household produces nothing scheduled: no reminder, no
 *    digest, no horizon job, no nudge. The audit found that a `WHERE` clause
 *    was the wrong shape for that promise — eight of the ten scheduled jobs
 *    never join `households` at all, and three of those read it ONLY to build
 *    a timezone Map with a `'UTC'` fallback, so a state filter there would
 *    not exclude a draft's rows, it would mislabel their timezone.
 *
 *    So the exclusion is enforced one level down, on the five tables those
 *    jobs actually enumerate. A draft cannot HOLD a shift, a commitment, a
 *    timesheet, a time entry or an arrangement, which makes every one of
 *    those sweeps structurally empty rather than filtered. This test is what
 *    stops that from silently becoming four tables.
 *
 * 2. THE FAIL-CLOSED STATUS. `candidate` reads nothing because every
 *    membership predicate in this schema is a POSITIVE `status = 'active'`.
 *    A single negated filter anywhere would grant her full household read
 *    access with nothing failing. This file refuses to let 093 introduce one.
 *
 * 3. THE D-51 COUPLING. The rate is on the public terms page only while all
 *    three of Marisol's conditions hold, and `link_expires_at` is one of
 *    them. Its presence is asserted here so that removing it has to be a
 *    deliberate act with a red test attached, not a quiet cleanup.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '093_draft_households.sql';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

// The `--` prefixes are stripped BEFORE joining. Without that, any asserted
// phrase that happens to wrap across two comment lines picks up a stray `--`
// in the middle and can never match — which would quietly turn every prose
// assertion below into one that only passes by luck of line-breaking.
const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .map(line => line.trimStart().replace(/^--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/**
 * The five tables the ten scheduled jobs enumerate. Adding a sixth
 * cron-visible table means adding a trigger here in the same change.
 */
const CRON_VISIBLE_TABLES = [
  'shifts',
  'child_commitments',
  'timesheets',
  'time_entries',
  'pay_arrangements',
] as const;

describe('093 — households gain a draft state', () => {
  it('adds `state` defaulting to live, so no row needs backfilling', () => {
    expect(executable).toContain(
      "add column if not exists state text not null default 'live'"
    );
  });

  it('constrains state to exactly draft and live', () => {
    expect(executable).toContain("check (state in ('draft', 'live'))");
  });

  it('makes name nullable — a nanny has no family name to give yet', () => {
    expect(executable).toContain('alter column name drop not null');
  });

  // The other half of nullability: only a DRAFT may go unnamed. Without this
  // the column change would quietly permit an unnamed live household, which
  // every name-rendering surface in both apps would then have to defend
  // against forever.
  it('still requires a name on every LIVE household', () => {
    expect(executable).toContain(
      "check (state = 'draft' or (name is not null and length(name) > 0))"
    );
  });

  it('uses the re-runnable drop-then-add constraint pattern', () => {
    expect(executable).toContain(
      'drop constraint if exists households_state_valid'
    );
    expect(executable).toContain(
      'drop constraint if exists households_live_has_name'
    );
  });
});

describe('093 — the cron invariant: a draft holds no schedulable row', () => {
  it('defines one refusal function rather than one per table', () => {
    expect(executable).toContain(
      'create or replace function private.refuse_write_in_draft_household()'
    );
  });

  it.each([
    ...CRON_VISIBLE_TABLES,
  ])('refuses inserts into %s for a draft household', table => {
    expect(executable).toContain(
      `before insert on public.${table} for each row execute function private.refuse_write_in_draft_household()`
    );
  });

  it('drops each trigger first so the migration is re-runnable', () => {
    for (const table of CRON_VISIBLE_TABLES) {
      expect(executable).toContain(`on public.${table};`);
    }
  });

  // BEFORE INSERT only, deliberately. A household goes draft -> live and never
  // back, so a row that was legal when written stays legal — and the
  // live-ward transition in 094 does not have to re-validate anything it
  // inherits. An UPDATE trigger here would fire on every ordinary edit for no
  // benefit.
  it('guards INSERT only — the transition is one-way', () => {
    expect(executable).not.toContain('before update on public.shifts');
    expect(executable).not.toContain('before delete on public.shifts');
  });

  it('revokes the refusal function from PUBLIC, anon and authenticated', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(executable).toContain(
        `revoke all on function private.refuse_write_in_draft_household() from ${role}`
      );
    }
  });

  // The reasoning is long and load-bearing; if somebody deletes it the next
  // reader will "simplify" this back into eight WHERE clauses.
  it('records the ten-job audit that produced this shape', () => {
    expect(commentText).toContain('the cron audit');
    expect(commentText).toContain('schedulehorizonjob');
    expect(commentText).toContain('uncovereddigestjob');
    expect(commentText).toContain('timezone lookup only');
  });
});

describe('093 — `candidate` is fail-closed by construction (D-49)', () => {
  it('widens the membership CHECK to admit candidate', () => {
    expect(executable).toContain(
      "check (status in ('active', 'removed', 'candidate'))"
    );
  });

  // The whole D-49 design rests on this. A negated filter would silently hand
  // a candidate every read a full member has, and no test anywhere would go
  // red — which is precisely why it is asserted against the migration text.
  it.each([
    "status != 'removed'",
    "status <> 'removed'",
    "status <> 'active'",
  ])('introduces no negated membership filter (%s)', negated => {
    expect(executable).not.toContain(negated);
  });

  it('leaves every positive active predicate in 009 untouched', () => {
    expect(executable).not.toContain('is_household_member');
    expect(executable).not.toContain('is_household_parent');
    expect(executable).not.toContain('household_ids_for_current_user');
  });

  it('warns future readers off the negated shape in prose too', () => {
    expect(commentText).toContain('fail-closed');
    expect(commentText).toContain('do not introduce one');
  });
});

describe('093 — the draft-author capability does not widen WRITE_ROLES', () => {
  it('defines is_draft_author', () => {
    expect(executable).toContain(
      'create or replace function private.is_draft_author(hid uuid)'
    );
  });

  // All three conjuncts matter. Without `created_by` a second nanny who
  // redeemed into a draft would inherit authorship of it; without the draft
  // state it would survive the household going live; without the role it
  // would apply to a parent who has their own, wider gate already.
  it('requires draft state AND the nanny role AND created_by', () => {
    expect(executable).toContain("h.state = 'draft'");
    expect(executable).toContain('h.created_by = (select auth.uid())');
    expect(executable).toContain("m.role = 'nanny'");
    expect(executable).toContain("m.status = 'active'");
  });

  it('revokes it from PUBLIC before granting (GOLDEN-FIXES #16)', () => {
    expect(executable).toContain(
      'revoke all on function private.is_draft_author(uuid) from public'
    );
    expect(executable).toContain(
      'grant execute on function private.is_draft_author(uuid) to service_role'
    );
  });

  it('records that the capability dies when the household goes live', () => {
    expect(commentText).toContain('evaluates false forever');
  });
});

describe('093 — the terms-link window (D-51 / M26)', () => {
  it('adds link_expires_at as a clock separate from the code expiry', () => {
    expect(executable).toContain(
      'add column if not exists link_expires_at timestamptz'
    );
  });

  it('adds opened_at for §5.3’s "Opened" state', () => {
    expect(executable).toContain(
      'add column if not exists opened_at timestamptz'
    );
  });

  it('adds her private recipient label, bounded', () => {
    expect(executable).toContain('add column if not exists label text');
    expect(executable).toContain('char_length(label) <= 80');
  });

  // If this coupling is ever forgotten, the rate quietly stays on a public
  // page whose owner-approved preconditions no longer hold.
  it('records the D-51 coupling so cutting one condition is deliberate', () => {
    expect(commentText).toContain('d-51');
    expect(commentText).toContain('takes the rate off the page');
  });

  it('leaves the 30-day code expiry in 009 alone', () => {
    expect(executable).not.toContain('expires_at timestamptz not null default');
  });
});
