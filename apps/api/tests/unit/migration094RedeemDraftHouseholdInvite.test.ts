/**
 * @module tests/unit/migration094RedeemDraftHouseholdInvite.test
 * Pattern A — migration contract for `094_redeem_draft_household_invite.sql`
 * (3-O, D-34 absorption + D-38 clone-not-consume + D-49 candidate).
 *
 * This function is the one place in 3-O where getting it subtly wrong is
 * expensive and silent, so its contract is pinned rather than reviewed.
 *
 * THE ANCHOR. 077 established the pattern and its header argues it at length:
 * lock the row everything else is derived from, then re-check the invariants
 * UNDER the lock, because the service's pre-flight reads happened before the
 * lock existed and their answers are stale by definition. Here the anchor is
 * the invite row. Two parents racing on one code serialise there or they
 * interleave, and interleaving means two households each half-built.
 *
 * D-38 IS AN INSERT, NEVER AN UPDATE. The single most load-bearing line in
 * this migration is that the nanny's draft proposal is COPIED. If that ever
 * becomes an UPDATE — which is the "obvious" optimisation, since the draft is
 * right there — she loses her reusable template the first time any family
 * redeems, and interviewing with four families in parallel stops working. The
 * test below refuses any UPDATE against `terms_proposals` in this file.
 *
 * D-49 IS AN ASYMMETRY ON PURPOSE. `candidate` on absorption, `active` on
 * instantiation. A household instantiated from her own draft has no prior
 * life to protect and no incumbent; making her a candidate there would lock
 * her out of the household she authored while she waits.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '094_redeem_draft_household_invite.sql';

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

const SIGNATURE = 'public.redeem_draft_household_invite(text, uuid, uuid)';

describe('094 — race safety: the invite row is the anchor', () => {
  it('locks the invite FOR UPDATE before reading anything else', () => {
    expect(executable).toContain(
      'select * into v_invite from public.household_invites where code = upper(btrim(p_code)) for update'
    );
  });

  it('locks an absorption target too, so two codes cannot interleave', () => {
    expect(executable).toContain(
      "from public.households where id = p_target_household_id and state = 'live' for update"
    );
  });

  // The same predicate `claimPending` uses. Extended, not reimplemented
  // (spec §17): what changes is that the six other writes now commit or roll
  // back WITH it, which is what retires the stranded-claim window on this path.
  it('claims with the same CAS predicate claimPending uses', () => {
    expect(executable).toContain(
      "update public.household_invites set status = 'accepted'"
    );
    expect(executable).toContain(
      "where id = v_invite.id and status = 'pending'"
    );
  });

  it('records that the CAS is extended rather than reimplemented', () => {
    expect(commentText).toContain('the cas is not reimplemented');
    expect(commentText).toContain('the same one `claimpending` uses');
  });

  // 077's discipline: refusals are outcomes the caller maps to its own error
  // types, so the opaque-404 convention stays owned by the API and nothing in
  // SQL has to know what an HTTP status is.
  it.each([
    'invite_unavailable',
    'not_a_draft_invite',
    'draft_has_no_author',
    'self_redemption',
    'target_not_permitted',
    'already_member',
    'proposal_already_open',
    'redeemed',
  ])('returns the %s outcome rather than raising', outcome => {
    expect(executable).toContain(`'${outcome}'`);
  });

  // Missing, revoked, expired and already-accepted collapse into ONE outcome.
  // Naming the reason would confirm the code was real, which is the existence-
  // hiding convention previewInvite's header protects (§17).
  it('collapses every unavailable-invite reason into one opaque outcome', () => {
    expect(executable).toContain(
      "v_invite.id is null or v_invite.status <> 'pending' or v_invite.expires_at < now()"
    );
  });
});

describe('094 — D-38: redemption copies, it never consumes', () => {
  it('INSERTs the proposal into the target household', () => {
    expect(executable).toContain('insert into public.terms_proposals');
  });

  // The line the whole of D-38 rests on. An UPDATE here would take her
  // template away the first time anybody redeemed.
  it('never UPDATEs terms_proposals — her draft is untouched', () => {
    expect(executable).not.toContain('update public.terms_proposals');
  });

  it('never archives, deletes or restatuses the draft household', () => {
    expect(executable).not.toContain('delete from public.households');
    expect(executable).not.toContain('update public.households');
  });

  it('stamps the invite on the clone so the draft home can resolve it', () => {
    expect(executable).toContain('from_invite_id');
    expect(executable).toContain('v_invite.id');
  });

  // Even the no-household case instantiates rather than promoting the draft.
  // One code path, one set of invariants, and her template survives every
  // permutation — which is the whole of D-38.
  it('instantiates a NEW live household rather than promoting the draft', () => {
    expect(executable).toContain('insert into public.households');
    expect(executable).toContain("'live'");
    expect(commentText).toContain('does not promote the draft');
  });

  it('carries her confirmed settings onto the new household', () => {
    for (const column of [
      'timezone',
      'currency',
      'jurisdiction',
      'week_starts_on',
    ]) {
      expect(executable).toContain(column);
    }
  });

  it('copies only unarchived children', () => {
    expect(executable).toContain('c.archived_at is null');
  });
});

describe('094 — D-49: candidate on absorption, active on instantiation', () => {
  it('derives the membership status from which path ran', () => {
    expect(executable).toContain(
      "v_nanny_status := case when v_instantiated then 'active' else 'candidate' end"
    );
  });

  it('joins her as a nanny, never as a parent or owner', () => {
    expect(executable).toContain(
      "values (v_target.id, v_nanny_id, 'nanny', false, v_nanny_status)"
    );
  });

  it('makes the redeemer the owner on the instantiated path', () => {
    expect(executable).toContain(
      "values (v_target.id, p_redeemer_id, 'owner', true, 'active')"
    );
  });

  // A parent removed between the service's read and this call must not absorb
  // a nanny. Positive filter, per 093's fail-closed rule — a `status <>
  // 'removed'` here would let a candidate absorb somebody.
  it('re-checks the redeemer under the lock with a POSITIVE active filter', () => {
    expect(executable).toContain("m.status = 'active'");
    expect(executable).toContain("m.role in ('owner', 'parent')");
    expect(executable).not.toContain("status <> 'removed'");
    expect(executable).not.toContain("status != 'removed'");
  });

  it('records why the asymmetry is deliberate', () => {
    expect(commentText).toContain('the asymmetry is the point');
  });

  // Refusing BEFORE the claim means a no-op never burns a single-use code.
  it('refuses an existing membership of ANY status before claiming', () => {
    expect(executable).toContain('if v_existing.id is not null then');
  });
});

describe('094 — GOLDEN-FIXES #31 and #16', () => {
  // 092's open-proposal index is partial, so PostgREST could never have named
  // it as a conflict target. The function catches the violation itself and
  // the membership insert rolls back with it, so nothing half-lands.
  it('catches the unique violation from the partial open-proposal index', () => {
    expect(executable).toContain('exception when unique_violation then');
    expect(commentText).toContain('golden-fixes #31');
  });

  it('revokes from PUBLIC, anon AND authenticated — all three', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(executable).toContain(
        `revoke all on function ${SIGNATURE} from ${role}`
      );
    }
  });

  it('grants execute to service_role only', () => {
    expect(executable).toContain(
      `grant execute on function ${SIGNATURE} to service_role`
    );
  });

  it('records why PUBLIC must be named explicitly', () => {
    expect(commentText).toContain('inherit from public at creation time');
  });

  it('carries a comment on the function, per house style', () => {
    expect(executable).toContain(
      'comment on function public.redeem_draft_household_invite'
    );
  });
});
