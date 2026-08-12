/**
 * @module tests/unit/migration096RedeemDraftInviteWeekStartsOn.test
 * Pattern A — migration contract for
 * `096_redeem_draft_invite_week_starts_on.sql` (D-8 at the redemption
 * boundary).
 *
 * 094 copied `v_draft.week_starts_on` into the household it instantiates, and
 * nothing has ever set that column on a nanny-authored draft — so 075's SQL
 * default of 1 (Monday) became a US family's FLSA workweek, locked by D-8 the
 * moment a timesheet exists. 096 lets the REDEEMER, who is the employer and
 * is holding a device with a region on it, answer instead.
 *
 * The two things that must not rot:
 *   - D46: a different arg list is an OVERLOAD, not a replacement. The exact
 *     old signature has to be dropped first or PostgREST sees two functions.
 *   - The override is INSTANTIATE-ONLY. §8 promised the parent "nothing
 *     changes for anyone already in your family", and a pay week is exactly
 *     the kind of thing that promise is about.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '096_redeem_draft_invite_week_starts_on.sql';

const migrationSql = readFileSync(join(migrationsDir, MIGRATION), 'utf8');

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

const NEW_SIGNATURE =
  'public.redeem_draft_household_invite(text, uuid, uuid, smallint)';

describe('096 — D46: drop the old signature, never overload it', () => {
  it('drops the exact three-argument signature before creating anything', () => {
    expect(executable).toContain(
      'drop function if exists public.redeem_draft_household_invite(text, uuid, uuid)'
    );
    expect(executable.indexOf('drop function')).toBeLessThan(
      executable.indexOf('create or replace function')
    );
  });

  it('records why a bare create-or-replace would not have worked', () => {
    expect(commentText).toContain('overload');
  });

  it('never edits 094 — the chain replays in order', () => {
    const original = readFileSync(
      join(migrationsDir, '094_redeem_draft_household_invite.sql'),
      'utf8'
    );
    expect(original).toContain('p_target_household_id uuid\n)');
    expect(original).not.toContain('p_week_starts_on');
  });
});

describe('096 — the workweek comes from the redeemer, instantiate only', () => {
  it('takes the redeemer’s week start, falling back to the draft', () => {
    expect(executable).toContain(
      'coalesce(p_week_starts_on, v_draft.week_starts_on)'
    );
  });

  it('never reads the parameter on the absorption branch', () => {
    // Exactly three references: the signature, the instantiate INSERT's
    // coalesce, and the `comment on function` prose. An absorption branch
    // that touched it would be a fourth.
    expect(executable.split('p_week_starts_on').length - 1).toBe(3);
  });

  it('defaults to null so an older client keeps the draft’s value', () => {
    expect(executable).toContain('p_week_starts_on smallint default null');
  });

  it('records that the workweek belongs to the employer', () => {
    expect(commentText).toContain('flsa');
    expect(commentText).toContain("the workweek is the employer's designation");
  });
});

describe('096 — GOLDEN-FIXES #16 on the NEW signature', () => {
  it('revokes from PUBLIC, anon AND authenticated — all three', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(executable).toContain(
        `revoke all on function ${NEW_SIGNATURE} from ${role}`
      );
    }
  });

  it('grants execute to service_role only', () => {
    expect(executable).toContain(
      `grant execute on function ${NEW_SIGNATURE} to service_role`
    );
  });

  it('carries a comment on the function, per house style', () => {
    expect(executable).toContain(
      'comment on function public.redeem_draft_household_invite'
    );
  });
});
