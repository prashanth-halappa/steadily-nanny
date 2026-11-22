/**
 * CROSS-IMPLEMENTATION PARITY for "which arrangement is in force on date D"
 * (audit item F-B10-7).
 *
 * The rule — greatest `valid_from <= date`, ties broken by `created_at desc`
 * (migration 041's header, `docs/11-MONEY.md` §2) — is written TWICE:
 *
 *   1. As SQL, in `PayArrangementRepository.effectiveOn`
 *      (`valid_from <= date ORDER BY valid_from DESC,
 *        julianday(created_at) DESC LIMIT 1`), run here against a real
 *      Miniflare D1 (tests/helpers/testDb.ts).
 *   2. As a loop, in `earningsService.effectiveOn` — because the engine is
 *      pure and prices seven dates from one fetch, so it cannot round-trip.
 *
 * Both files say "if that rule ever changes it must change in both places at
 * once", and neither had anything that would notice if it did not. This file
 * is that something: ONE vector table, run through BOTH implementations, so a
 * change to either alone goes red.
 *
 * Vectors live in `VECTORS` below and are asserted identically against each
 * side. Nothing here re-tests the query SHAPE (that is
 * `payArrangementRepository.test.ts`'s job) — only the answer.
 *
 * D-16 (3-U1, `docs/design/screens-pay-terms.md` §6): "future `valid_from`
 * allowed, engine must never price a future row early — extend `effectiveOn`
 * tests." Both implementations ALREADY exclude `valid_from > date` (the
 * `valid_from <= date` filter / the `candidate.valid_from > date`
 * `continue` — see each file's own doc), so allowing
 * `payArrangementCommandService.create` to WRITE a future-dated row required
 * no change here: the resolution rule already treats "not yet in force" and
 * "in force" identically whether the row was written yesterday or written
 * three months in advance. The vectors below are the D-16-labelled proof of
 * that, not new behaviour — "a valid_from one day AFTER the query date is
 * not yet in force", "a future row never displaces the one actually in
 * force" and "BOUNDARY: valid_from exactly ON the query date is already in
 * force" (below) together are the whole round trip: SCHEDULED → stays inert
 * → becomes the answer the instant its date arrives, never a day early.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import {
  households,
  payArrangements,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import type { PayArrangement } from '../../../../../src/domains/pay/types';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

interface FakeRow {
  [key: string]: unknown;
}

let PayArrangementRepository: any;
let t: TestDb;
let engineEffectiveOn: (
  arrangements: readonly PayArrangement[],
  date: string
) => PayArrangement | null;

/*
 * WHY `created_at` IS ORDERED BY INSTANT: on D1 it is ISO-8601 TEXT, and the
 * same instant has more than one legal spelling (`+00:00`, `+01:00`, `.000Z`;
 * GOLDEN-FIXES #25). Postgres ordered the old timestamptz by instant, so the
 * repository orders by `julianday(created_at)` — a text ORDER BY would model
 * a database that no longer exists and fail the #25 vectors below, which are
 * the reason this file has to exist. Rows are inserted with their
 * `created_at` spelled exactly as the vector writes it.
 */

const HOUSEHOLD_ID = 'h1';
const CARER_ID = 'carer-1';

function row(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'pa-1',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    rate_minor: 1500,
    currency: 'GBP',
    valid_from: '2026-01-01',
    created_at: '2026-01-01T09:00:00.000Z',
    carer_display_name: 'Maria',
    ...overrides,
  };
}

interface Vector {
  name: string;
  rows: FakeRow[];
  date: string;
  /** The id both implementations must resolve, or null for "nothing in force". */
  expected: string | null;
}

const VECTORS: Vector[] = [
  // --- 065: an arrangement ended by member removal ---
  {
    name: '065: an arrangement that ended is not in force after its valid_to',
    rows: [
      row({ id: 'pa-ended', valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ],
    date: '2026-08-04',
    expected: null,
  },
  {
    // THE load-bearing case: a March week must keep pricing at March's rate
    // after a July removal, on BOTH sides — the engine prices historical
    // weeks from one unfiltered fetch of the whole history.
    name: '065: an ended arrangement still prices a date before the end',
    rows: [
      row({ id: 'pa-ended', valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ],
    date: '2026-03-15',
    expected: 'pa-ended',
  },
  {
    name: '065: valid_to is inclusive — the end date itself still prices',
    rows: [
      row({ id: 'pa-ended', valid_from: '2026-01-01', valid_to: '2026-06-30' }),
    ],
    date: '2026-06-30',
    expected: 'pa-ended',
  },
  {
    name: '065: new terms after a rejoin supersede the ended ones',
    rows: [
      row({ id: 'pa-ended', valid_from: '2026-01-01', valid_to: '2026-06-30' }),
      row({
        id: 'pa-rejoin',
        valid_from: '2026-09-01',
        created_at: '2026-09-01T09:00:00.000Z',
      }),
    ],
    date: '2026-09-15',
    expected: 'pa-rejoin',
  },
  {
    name: '065: between the end and the new terms, nothing is in force',
    rows: [
      row({ id: 'pa-ended', valid_from: '2026-01-01', valid_to: '2026-06-30' }),
      row({
        id: 'pa-rejoin',
        valid_from: '2026-09-01',
        created_at: '2026-09-01T09:00:00.000Z',
      }),
    ],
    date: '2026-08-04',
    expected: null,
  },
  {
    name: 'no arrangements at all resolves to nothing',
    rows: [],
    date: '2026-08-04',
    expected: null,
  },
  {
    name: 'the later valid_from wins',
    rows: [
      row({
        id: 'pa-old',
        valid_from: '2026-01-01',
        created_at: '2026-01-01T09:00:00.000Z',
      }),
      row({
        id: 'pa-raise',
        valid_from: '2026-07-01',
        created_at: '2026-06-20T09:00:00.000Z',
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-raise',
  },
  {
    name: 'the later valid_from still wins when supplied newest-first',
    rows: [
      row({
        id: 'pa-raise',
        valid_from: '2026-07-01',
        created_at: '2026-06-20T09:00:00.000Z',
      }),
      row({
        id: 'pa-old',
        valid_from: '2026-01-01',
        created_at: '2026-01-01T09:00:00.000Z',
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-raise',
  },
  {
    name: 'BOUNDARY: valid_from exactly ON the query date is already in force',
    rows: [row({ id: 'pa-today', valid_from: '2026-08-04' })],
    date: '2026-08-04',
    expected: 'pa-today',
  },
  {
    name: 'a valid_from one day AFTER the query date is not yet in force',
    rows: [row({ id: 'pa-tomorrow', valid_from: '2026-08-05' })],
    date: '2026-08-04',
    expected: null,
  },
  {
    name: 'a future row never displaces the one actually in force',
    rows: [
      row({ id: 'pa-current', valid_from: '2026-01-01' }),
      row({
        id: 'pa-future',
        valid_from: '2026-09-01',
        created_at: '2026-08-20T09:00:00.000Z',
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-current',
  },
  {
    // D-16: a scheduled raise written MONTHS before it takes effect (the
    // `created_at` here is 2026-08-04, three weeks before the `created_at`
    // of the vector above) is still invisible to every date before its
    // `valid_from` — how far in advance it was WRITTEN never matters, only
    // the date being priced.
    name: 'D-16: a change scheduled months in advance stays inert until its date, however early it was written',
    rows: [
      row({ id: 'pa-current', valid_from: '2026-01-01' }),
      row({
        id: 'pa-scheduled',
        valid_from: '2026-09-01',
        created_at: '2026-06-01T09:00:00.000Z',
      }),
    ],
    date: '2026-08-31',
    expected: 'pa-current',
  },
  {
    // D-16's other half: the SAME scheduled row becomes the answer the
    // instant its date arrives — no lag, no re-write needed.
    name: 'D-16: the same scheduled change is in force the day it arrives',
    rows: [
      row({ id: 'pa-current', valid_from: '2026-01-01' }),
      row({
        id: 'pa-scheduled',
        valid_from: '2026-09-01',
        created_at: '2026-06-01T09:00:00.000Z',
      }),
    ],
    date: '2026-09-01',
    expected: 'pa-scheduled',
  },
  {
    name: 'SAME-DAY CORRECTION: on a valid_from tie the later created_at supersedes the typo',
    rows: [
      row({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:00:00.000Z',
        rate_minor: 150,
      }),
      row({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T11:00:00.000Z',
        rate_minor: 1500,
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-fix',
  },
  {
    name: 'SAME-DAY CORRECTION: the tie-break holds with the correction supplied FIRST',
    rows: [
      row({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T11:00:00.000Z',
        rate_minor: 1500,
      }),
      row({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:00:00.000Z',
        rate_minor: 150,
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-fix',
  },
  {
    // GOLDEN-FIXES #25. `+01:00` sorts ABOVE `.000Z` as a string here
    // ('11:00:00+01:00' > '10:30:00.000Z' at the hours digit) while being the
    // EARLIER instant (10:00Z vs 10:30Z). Anything that string-compares
    // `created_at` picks the typo back up.
    name: 'GOLDEN-FIXES #25: a later instant written .000Z beats an earlier one written +01:00',
    rows: [
      row({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T11:00:00+01:00', // 10:00Z — earlier
        rate_minor: 150,
      }),
      row({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T10:30:00.000Z', // 10:30Z — later
        rate_minor: 1500,
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-fix',
  },
  {
    // The mirror, so neither implementation can pass by simply preferring one
    // spelling: here the offset form IS the later instant (10:30Z vs 10:00Z)
    // and sorts BELOW `.000Z` as a string ('09:30:00-01:00' < '10:00:00.000Z').
    name: 'GOLDEN-FIXES #25: a later instant written -01:00 beats an earlier one written .000Z',
    rows: [
      row({
        id: 'pa-typo',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T10:00:00.000Z', // 10:00Z — earlier
        rate_minor: 150,
      }),
      row({
        id: 'pa-fix',
        valid_from: '2026-08-01',
        created_at: '2026-08-01T09:30:00-01:00', // 10:30Z — later
        rate_minor: 1500,
      }),
    ],
    date: '2026-08-04',
    expected: 'pa-fix',
  },
];

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  await t.db
    .insert(user)
    .values({ id: CARER_ID, name: 'Maria', email: 'maria@x.test' });
  await t.db.insert(userProfiles).values({ user_id: CARER_ID });
  await t.db.insert(households).values({ id: HOUSEHOLD_ID, name: 'One' });

  PayArrangementRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/payArrangementRepository'
    )
  ).PayArrangementRepository;
  engineEffectiveOn = (
    await import('../../../../../src/domains/pay/services/earningsService')
  ).effectiveOn;
});
afterAll(() => t.dispose());

/** The repository's answer for a vector — the SQL side. */
async function resolveViaRepository(
  rows: FakeRow[],
  date: string
): Promise<string | null> {
  await t.d1.prepare('DELETE FROM pay_arrangements').run();
  if (rows.length) await t.db.insert(payArrangements).values(rows as any);
  const found = await new PayArrangementRepository().effectiveOn(
    HOUSEHOLD_ID,
    CARER_ID,
    date
  );
  return (found?.id as string | undefined) ?? null;
}

/** The engine's answer for the same vector — the in-memory side. */
function resolveViaEngine(rows: FakeRow[], date: string): string | null {
  const found = engineEffectiveOn(rows as unknown as PayArrangement[], date);
  return found?.id ?? null;
}

describe('effectiveOn parity — repository SQL vs the engine loop (F-B10-7)', () => {
  describe('PayArrangementRepository.effectiveOn', () => {
    for (const vector of VECTORS) {
      it(vector.name, async () => {
        expect(await resolveViaRepository(vector.rows, vector.date)).toBe(
          vector.expected
        );
      });
    }
  });

  describe('earningsService.effectiveOn', () => {
    for (const vector of VECTORS) {
      it(vector.name, () => {
        expect(resolveViaEngine(vector.rows, vector.date)).toBe(
          vector.expected
        );
      });
    }
  });

  describe('the two agree, vector for vector', () => {
    for (const vector of VECTORS) {
      it(vector.name, async () => {
        expect(await resolveViaRepository(vector.rows, vector.date)).toBe(
          resolveViaEngine(vector.rows, vector.date)
        );
      });
    }
  });

  /**
   * The one part of the rule the vector table CANNOT express: two rows with
   * the same `valid_from` AND the same created_at INSTANT, written in the two
   * different ISO-8601 spellings (GOLDEN-FIXES #25). Which of the two wins is
   * genuinely undefined — `ORDER BY … DESC` makes an arbitrary choice
   * between equal keys — so there is no id to pin. What IS defined is
   * that the answer must not depend on the SPELLING: swap which row carries
   * `+00:00` and which carries `.000Z`, change nothing else, and the same row
   * must still win. A string compare fails this immediately ('+' sorts below
   * '.', so `.000Z` always wins and the winner flips with the spelling).
   */
  it('a same-INSTANT tie resolves identically whichever row is spelled +00:00 and which .000Z', async () => {
    const variant = (aCreatedAt: string, bCreatedAt: string): FakeRow[] => [
      row({ id: 'pa-a', valid_from: '2026-08-01', created_at: aCreatedAt }),
      row({ id: 'pa-b', valid_from: '2026-08-01', created_at: bCreatedAt }),
    ];
    const OFFSET = '2026-08-01T10:00:00+00:00';
    const ZULU = '2026-08-01T10:00:00.000Z';

    const repoOffsetFirst = await resolveViaRepository(
      variant(OFFSET, ZULU),
      '2026-08-04'
    );
    const repoZuluFirst = await resolveViaRepository(
      variant(ZULU, OFFSET),
      '2026-08-04'
    );
    expect(repoOffsetFirst).toBe(repoZuluFirst);

    const engineOffsetFirst = resolveViaEngine(
      variant(OFFSET, ZULU),
      '2026-08-04'
    );
    const engineZuluFirst = resolveViaEngine(
      variant(ZULU, OFFSET),
      '2026-08-04'
    );
    expect(engineOffsetFirst).toBe(engineZuluFirst);

    // …and the two implementations land on the same row as each other.
    expect(repoOffsetFirst).toBe(engineOffsetFirst);
  });
});
