/**
 * @module tests/unit/migration092TermsProposals.test
 * Pattern A — migration contract for `092_terms_proposals.sql` (3-O, D-35).
 *
 * Two things in this migration would break something important without
 * breaking any other test, so they are pinned here.
 *
 * THE CARER SELF-ARM IS THE CANDIDATE'S ONE DOOR. §8.2.1 makes a redeemed
 * nanny a `candidate` who matches no `status = 'active'` predicate anywhere,
 * so she reads nothing of the household she just joined — except her own
 * proposal, and that exception exists solely because this table's select
 * policy tests `carer_id = auth.uid()` WITHOUT consulting `household_members`.
 * Rewriting that arm to go through a membership helper — which looks like a
 * tidy-up — would lock her out of the only screen she has during the
 * candidate window, and nothing else would fail.
 *
 * THE READ CIRCLE IS NARROWER THAN THE HOUSEHOLD. A proposal carries a rate.
 * `can_read_household` would hand it to a helper and to the OTHER nanny, which
 * is the exact P4/P8 shape 087 just finished closing. 041's header states the
 * rule this file enforces: a policy looser than the service is not
 * belt-and-braces, it is the hole the service was written to close.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '092_terms_proposals.sql';

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

/** The one predicate every money table in this schema already uses. */
const MONEY_READ_CIRCLE =
  'private.can_write_household(household_id) or carer_id = (select auth.uid())';

describe('092 — the proposal object', () => {
  it('creates the table', () => {
    expect(executable).toContain(
      'create table if not exists public.terms_proposals'
    );
  });

  it('constrains the lifecycle to §10’s four state words', () => {
    expect(executable).toContain(
      "check (status in ('proposed', 'countered', 'accepted', 'withdrawn'))"
    );
  });

  it('constrains direction to the two sides, not to roles', () => {
    expect(executable).toContain("check (direction in ('carer', 'parent'))");
  });

  // A counter is a NEW row naming its predecessor. If this column ever goes
  // away, "How we got here" (§7.2) silently becomes a list rather than a
  // history, and the append-only promise becomes unverifiable.
  it('links a counter to the row it superseded', () => {
    expect(executable).toContain(
      'supersedes_id uuid references public.terms_proposals(id) on delete set null'
    );
  });

  // D-38: the clone carries the invite it arrived on, which is how the draft
  // home resolves "did the Bakers actually open my terms".
  it('stamps the invite a cloned proposal arrived on', () => {
    expect(executable).toContain(
      'from_invite_id uuid references public.household_invites(id) on delete set null'
    );
  });

  // 033's lifecycle discipline: a carer who deletes her account must not take
  // the family's record of what was agreed with her.
  it('does not cascade-delete a proposal with its carer', () => {
    expect(executable).toContain('carer_id uuid not null');
    expect(executable).not.toContain(
      'carer_id uuid not null references public.user_profiles'
    );
  });

  it('cascades from the household, per 033', () => {
    expect(executable).toContain(
      'household_id uuid not null references public.households(id) on delete cascade'
    );
  });
});

describe('092 — D-7 is enforced, not merely rendered', () => {
  // The wire refuses a missing checkbox, the service refuses it, and so does
  // the database. An acceptance without it is not an acceptance — it is a
  // liability with a timestamp.
  it('refuses an accepted proposal with no responsibility confirmation', () => {
    expect(executable).toContain(
      "check (status <> 'accepted' or responsibility_confirmed)"
    );
  });

  // §10: the word appears WITH A DATE, every time the figure is shown. A row
  // that has left `proposed` and cannot say when would force a rendering
  // fallback that invents one.
  it('requires a responded_at on every row that left proposed', () => {
    expect(executable).toContain(
      "check (status = 'proposed' or responded_at is not null)"
    );
  });
});

describe('092 — at most one open proposal per carer', () => {
  it('enforces §9.1’s Withdraw state as an index, not a UI rule', () => {
    expect(executable).toContain(
      "create unique index if not exists terms_proposals_open_unique_idx on public.terms_proposals (household_id, carer_id) where status = 'proposed'"
    );
  });

  // GOLDEN-FIXES #31: PostgREST's `onConflict` takes a column-name list only,
  // so a PARTIAL index can never be named as a conflict target and
  // `ignoreDuplicates` buys nothing against it. The service has to catch the
  // 23505 and name this index — a bare error-code skip would swallow an
  // unrelated constraint violation as "already there".
  it('records that the partial index needs #31 handling in the service', () => {
    expect(commentText).toContain('golden-fixes #31');
    expect(commentText).toContain('partial');
  });
});

describe('092 — RLS: the money read circle, with the candidate’s one door', () => {
  it('enables row level security', () => {
    expect(executable).toContain(
      'alter table public.terms_proposals enable row level security'
    );
  });

  it('uses the 041/044/067/086 predicate verbatim', () => {
    const policy =
      /create policy "[^"]+" on public\.terms_proposals for select using \(([^;]*?)\)\s*;/.exec(
        `${executable};`
      );
    expect(policy?.[1]?.replace(/\s+/g, ' ').trim()).toBe(MONEY_READ_CIRCLE);
  });

  it('never uses can_read_household — a helper sees no rate', () => {
    expect(executable).not.toContain('can_read_household');
  });

  it('keeps the helper call BARE (040 trap 2 — no (select …) wrapper)', () => {
    expect(executable).not.toContain('(select private.can_write_household');
  });

  it('keeps 018’s initplan form on the carer self-arm', () => {
    expect(executable).toContain('carer_id = (select auth.uid())');
  });

  it('adds no insert/update/delete policy — writes are service-role', () => {
    expect(executable).not.toContain('for insert');
    expect(executable).not.toContain('for delete');
    // `for update` appears only on the updated_at trigger, never as a policy.
    expect(executable).not.toContain('create policy "[^"]+" for update');
  });

  // Without this note the self-arm reads like an inconsistency with every
  // other membership check in the schema, and someone tidies it away.
  it('records that the self-arm is what the candidate window depends on', () => {
    expect(commentText).toContain('load-bearing for d-49');
    expect(commentText).toContain('does not consult `household_members`');
  });
});
