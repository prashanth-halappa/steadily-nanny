/**
 * @module tests/unit/migration098InvitePayOffer.test
 * Pattern A — migration contract for `098_invite_pay_offer.sql` (gap P8).
 *
 * Three things in this migration would break something important without
 * breaking any other test, so they are pinned here.
 *
 * THE COLUMN MUST STAY NULLABLE AND UNDEFAULTED. An offer is what a parent
 * CHOSE to write down before a nanny existed; a default would make every
 * invite ever minted carry terms nobody typed, and the promotion in
 * `redeemInvite` guards on `pay_offer !== null`. A `not null` would be worse
 * still — every co-parent and helper invite would have to invent pay terms.
 *
 * NO RLS CHANGE IS THE FEATURE, NOT AN OMISSION. 093's SELECT policy on
 * `household_invites` admits parents and draft authors only, so the invitee
 * cannot read the offer before she redeems — she meets it as a proposal, on
 * the proposal's own read circle, or not at all. A future tidy-up that widens
 * that policy "so the invitee can preview her offer" puts a rate on a row
 * anybody holding a code can address, and nothing else here would fail.
 *
 * NO CHECK CONSTRAINTS ON THE BODY. Same deliberate choice as
 * `terms_proposals.terms` (092): the payload is a `CreatePayArrangementRequest`
 * validated by Zod at the boundary, and every money bound fires on the
 * `pay_arrangements` INSERT at acceptance. A constraint added here would be a
 * second, drifting copy of those bounds.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '098_invite_pay_offer.sql';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);

// The `--` prefixes are stripped BEFORE joining, exactly as
// `migration092TermsProposals.test.ts` does it. Without that, an asserted
// phrase that happens to wrap across two comment lines picks up a stray `--`
// in the middle and can never match — which would quietly turn every prose
// assertion below into one that only passes by luck of line-breaking.
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .map(line => line.trimStart().replace(/^--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('098 — the invite pay offer', () => {
  it('adds the column idempotently, as 093 added its three', () => {
    expect(executable).toContain(
      'alter table public.household_invites add column if not exists pay_offer jsonb'
    );
  });

  it('leaves it nullable and undefaulted — an offer is a choice, never a fill-in', () => {
    expect(executable).not.toContain('pay_offer jsonb not null');
    expect(executable).not.toContain('pay_offer jsonb default');
  });

  it('puts no CHECK constraint on the body, like 092 put none on terms', () => {
    expect(executable).not.toContain('pay_offer_');
    expect(executable).not.toMatch(/check \([^)]*pay_offer/);
  });

  it('documents the column as non-binding and invite-scoped', () => {
    expect(executable).toContain(
      'comment on column public.household_invites.pay_offer is'
    );
    const comment = executable.slice(
      executable.indexOf('comment on column public.household_invites.pay_offer')
    );
    expect(comment).toContain('createpayarrangementrequest');
    expect(comment).toContain('non-binding');
    expect(comment).toContain("direction=''parent''");
  });

  it('re-comments from_invite_id as bidirectional — 092 said only "a nanny’s draft"', () => {
    expect(executable).toContain(
      'comment on column public.terms_proposals.from_invite_id is'
    );
    const comment = executable.slice(
      executable.indexOf(
        'comment on column public.terms_proposals.from_invite_id'
      )
    );
    // Both provenances, named. A re-comment that mentions only the new one
    // would erase 094/096's clone and read as a behaviour change.
    expect(comment).toContain('cloned');
    expect(comment).toContain('promoted');
  });

  it('states in the header that the RLS policy is deliberately untouched', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain('drop policy');
    expect(commentText).toContain('no rls change');
  });

  it('records that the offer dies with the invite and never binds alone', () => {
    expect(commentText).toContain('never binds by itself');
  });

  it('names the mirror it is copying — the nanny direction already does this', () => {
    expect(commentText).toContain('096');
  });

  it('carries the "not `supabase db push`" apply note every migration since 074 carries', () => {
    expect(commentText).toContain('supabase db push');
  });
});
