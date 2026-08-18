/**
 * @module tests/unit/migration106InvitePayOfferPromotion.test
 * Pattern A — migration contract for `106_invite_pay_offer_promotion.sql` (F3).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '106_invite_pay_offer_promotion.sql';

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
// `migration098InvitePayOffer.test.ts` does it.
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

describe('106 — the pay-offer promotion outcome', () => {
  it('adds the column idempotently, as 098 added pay_offer', () => {
    expect(executable).toContain(
      'alter table public.household_invites add column if not exists pay_offer_promotion text'
    );
  });

  it('is an ALTER, never a destructive op', () => {
    expect(executable).not.toContain('drop table');
    expect(executable).not.toContain('drop column');
    expect(executable).not.toContain('truncate');
  });

  it('leaves it nullable and undefaulted', () => {
    expect(executable).not.toContain('pay_offer_promotion text not null');
    expect(executable).not.toContain('pay_offer_promotion text default');
  });

  it('constrains it to exactly the five outcomes', () => {
    expect(executable).toContain(
      "check (pay_offer_promotion in ( 'promoted', 'skipped_open_round', 'skipped_stale', 'skipped_no_inviter', 'failed' ))"
    );
  });

  it('documents the column as the only record, since the promoter never throws', () => {
    expect(executable).toContain(
      'comment on column public.household_invites.pay_offer_promotion is'
    );
    const comment = executable.slice(
      executable.indexOf(
        'comment on column public.household_invites.pay_offer_promotion'
      )
    );
    expect(comment).toContain('never throws');
  });

  it('carries the "not `supabase db push`" apply note every migration since 074 carries', () => {
    expect(commentText).toContain('supabase db push');
  });
});
