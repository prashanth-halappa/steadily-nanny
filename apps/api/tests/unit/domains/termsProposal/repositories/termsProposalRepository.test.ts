/**
 * The two things this repository does that `BaseRepository` does not:
 *
 *  - translate the unique violation raised by `terms_proposals_open_unique_idx`
 *    (092, a PARTIAL index) into a typed conflict. GOLDEN-FIXES #31: a partial
 *    index can never be an `onConflict` target, so catching the violation is
 *    the only option — and the catch must NAME the index, or an unrelated
 *    constraint violation gets swallowed as "already open".
 *  - CAS the lifecycle stamps on `status = 'proposed'`, so two simultaneous
 *    answers to one proposal cannot both win.
 *
 * Runs against a real Miniflare D1 (tests/helpers/testDb.ts), so the filters,
 * the partial index and the CAS are the database's, not a fake's.
 *
 * @module tests/unit/domains/termsProposal/repositories/termsProposalRepository
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { eq } from 'drizzle-orm';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../../../src/db/schema';
import { households, termsProposals } from '../../../../../src/db/schema';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let TermsProposalRepository: any;
let OpenTermsProposalExistsError: any;
let DatabaseError: any;
let t: TestDb;
/** Flip to route the repository at a D1 whose every prepare() throws. */
let broken = false;
const brokenDb = drizzle(
  {
    prepare: () => {
      throw new Error('boom');
    },
  } as unknown as AnyD1Database,
  { schema }
);

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURE_STAMP_AT = new Date().toISOString();
const FIXTURE_PRIOR_VIEWED_AT = new Date(Date.now() - 3 * DAY_MS).toISOString();

function row(overrides: Record<string, unknown> = {}): any {
  return {
    household_id: 'h1',
    carer_id: 'carer-1',
    proposed_by: 'carer-1',
    direction: 'carer',
    terms: { rate_minor: 2800 },
    note: null,
    supersedes_id: null,
    from_invite_id: null,
    carer_display_name: 'Maria',
    ...overrides,
  };
}

async function seed(overrides: Record<string, unknown> = {}): Promise<any> {
  const [inserted] = await t.db
    .insert(termsProposals)
    .values(row(overrides))
    .returning();
  return inserted;
}

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({
    db: new Proxy(
      {},
      { get: (_target, key) => Reflect.get(broken ? brokenDb : t.db, key) }
    ),
  }));
  await t.db.insert(households).values([
    { id: 'h1', name: 'One' },
    { id: 'h2', name: 'Two' },
  ]);

  TermsProposalRepository = (
    await import(
      '../../../../../src/domains/termsProposal/repositories/termsProposalRepository'
    )
  ).TermsProposalRepository;
  OpenTermsProposalExistsError = (
    await import(
      '../../../../../src/domains/termsProposal/errors/termsProposalErrors'
    )
  ).OpenTermsProposalExistsError;
  DatabaseError = (await import('../../../../../src/errors')).DatabaseError;
});
afterAll(() => t.dispose());

beforeEach(async () => {
  broken = false;
  await t.d1.prepare('DELETE FROM terms_proposals').run();
});

describe('TermsProposalRepository.create — GOLDEN-FIXES #31', () => {
  it('returns the inserted row, terms parsed back from JSON', async () => {
    const created = await new TermsProposalRepository().create(row());
    expect(created.direction).toBe('carer');
    expect(created.status).toBe('proposed');
    expect(created.terms).toEqual({ rate_minor: 2800 });
  });

  it('a second OPEN round for the pair hits the real partial index → OpenTermsProposalExistsError', async () => {
    const repo = new TermsProposalRepository();
    await repo.create(row());
    const thrown = await repo.create(row()).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(OpenTermsProposalExistsError);
  });

  it('the index is PARTIAL: a resolved round does not block a new one', async () => {
    await seed({ status: 'countered', responded_at: FIXTURE_STAMP_AT });
    const created = await new TermsProposalRepository().create(row());
    expect(created.status).toBe('proposed');
  });

  it('a unique violation from ANOTHER constraint still surfaces, never swallowed as "already open"', async () => {
    // Duplicate primary key: `terms_proposals_pkey`, not the open index.
    const existing = await seed({ status: 'countered', responded_at: 'x' });
    const thrown = await new TermsProposalRepository()
      .create(row({ id: existing.id }))
      .catch((error: unknown) => error);
    expect(thrown).not.toBeInstanceOf(OpenTermsProposalExistsError);
    expect(thrown).toBeInstanceOf(DatabaseError);
  });

  it('a non-unique error is a DatabaseError', async () => {
    const thrown = await new TermsProposalRepository()
      .create(row({ direction: 'sideways' }))
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DatabaseError);
    expect(thrown).not.toBeInstanceOf(OpenTermsProposalExistsError);
  });
});

describe('TermsProposalRepository.findOpenForCarer', () => {
  it('filters household, carer AND status=proposed', async () => {
    const open = await seed();
    await seed({ status: 'countered', responded_at: FIXTURE_STAMP_AT });
    await seed({ household_id: 'h2' });
    await seed({ carer_id: 'carer-2' });
    const found = await new TermsProposalRepository().findOpenForCarer(
      'h1',
      'carer-1'
    );
    expect(found?.id).toBe(open.id);
  });

  it('returns null when nothing is open', async () => {
    await seed({ status: 'countered', responded_at: FIXTURE_STAMP_AT });
    expect(
      await new TermsProposalRepository().findOpenForCarer('h1', 'carer-1')
    ).toBeNull();
  });
});

describe('TermsProposalRepository.listChain', () => {
  it('scopes to the pair and orders newest first', async () => {
    const older = await seed({
      status: 'countered',
      responded_at: FIXTURE_STAMP_AT,
      created_at: '2026-08-01T09:00:00.000Z',
    });
    const newer = await seed({ created_at: '2026-08-02T09:00:00.000Z' });
    await seed({ carer_id: 'carer-2' });
    await seed({ household_id: 'h2' });
    const rows = await new TermsProposalRepository().listChain('h1', 'carer-1');
    expect(rows.map((r: any) => r.id)).toEqual([newer.id, older.id]);
  });

  it('a query error becomes a DatabaseError, never a silent empty history', async () => {
    broken = true;
    await expect(
      new TermsProposalRepository().listChain('h1', 'carer-1')
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('TermsProposalRepository.resolve — CAS on status=proposed', () => {
  it('patches a proposed row and returns it, updated_at current', async () => {
    const before = await seed({ updated_at: '2026-01-01T00:00:00.000Z' });
    const updated = await new TermsProposalRepository().resolve(before.id, {
      status: 'countered',
      responded_at: FIXTURE_STAMP_AT,
    });
    expect(updated?.status).toBe('countered');
    expect(updated?.responded_at).toBe(FIXTURE_STAMP_AT);
    expect(updated?.updated_at > before.updated_at).toBe(true);
  });

  it('returns null when the row has already left proposed — the loser of a race', async () => {
    const accepted = await seed({
      status: 'accepted',
      responded_at: FIXTURE_STAMP_AT,
      responsibility_confirmed: true,
    });
    expect(
      await new TermsProposalRepository().resolve(accepted.id, {
        status: 'withdrawn',
        responded_at: FIXTURE_STAMP_AT,
      })
    ).toBeNull();
  });

  it('two concurrent resolves: exactly one wins', async () => {
    const open = await seed();
    const repo = new TermsProposalRepository();
    const results = await Promise.all([
      repo.resolve(open.id, {
        status: 'withdrawn',
        responded_at: FIXTURE_STAMP_AT,
      }),
      repo.resolve(open.id, {
        status: 'countered',
        responded_at: FIXTURE_STAMP_AT,
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('TermsProposalRepository.withdrawOpenForCarer — CAS on status=proposed (F8)', () => {
  it('withdraws the open round and stamps responded_at', async () => {
    await seed();
    await seed({ household_id: 'h2' });
    const withdrawn = await new TermsProposalRepository().withdrawOpenForCarer(
      'h1',
      'carer-1'
    );
    expect(withdrawn?.status).toBe('withdrawn');
    expect(withdrawn?.responded_at).toBeTruthy();
    // The other household's open round is untouched.
    const [other] = await t.db
      .select()
      .from(termsProposals)
      .where(eq(termsProposals.household_id, 'h2'));
    expect(other?.status).toBe('proposed');
  });

  it('leaves a non-open row untouched — already accepted/declined/etc.', async () => {
    await seed({
      status: 'accepted',
      responded_at: FIXTURE_STAMP_AT,
      responsibility_confirmed: true,
    });
    expect(
      await new TermsProposalRepository().withdrawOpenForCarer('h1', 'carer-1')
    ).toBeNull();
  });

  it('a query error becomes a DatabaseError', async () => {
    broken = true;
    await expect(
      new TermsProposalRepository().withdrawOpenForCarer('h1', 'carer-1')
    ).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe('TermsProposalRepository.stampViewed — one-way', () => {
  it('only writes when viewed_at is still null', async () => {
    const open = await seed();
    const stamped = await new TermsProposalRepository().stampViewed(
      open.id,
      FIXTURE_STAMP_AT
    );
    expect(stamped?.viewed_at).toBe(FIXTURE_STAMP_AT);
  });

  it('never re-stamps a row that already carries a viewed_at', async () => {
    const viewed = await seed({ viewed_at: FIXTURE_PRIOR_VIEWED_AT });
    expect(
      await new TermsProposalRepository().stampViewed(
        viewed.id,
        FIXTURE_STAMP_AT
      )
    ).toBeNull();
  });
});
