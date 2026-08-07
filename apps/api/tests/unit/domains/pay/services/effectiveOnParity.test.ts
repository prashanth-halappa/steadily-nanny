/**
 * CROSS-IMPLEMENTATION PARITY for "which arrangement is in force on date D"
 * (audit item F-B10-7).
 *
 * The rule — greatest `valid_from <= date`, ties broken by `created_at desc`
 * (migration 041's header, `docs/11-MONEY.md` §2) — is written TWICE:
 *
 *   1. As SQL, in `PayArrangementRepository.effectiveOn`
 *      (`.lte('valid_from', date).order('valid_from', desc)
 *        .order('created_at', desc).limit(1)`).
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
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import type { PayArrangement } from '../../../../../src/domains/pay/types';

interface FakeRow {
  [key: string]: unknown;
}

let PayArrangementRepository: any;
let mockSupabaseService: any;
let engineEffectiveOn: (
  arrangements: readonly PayArrangement[],
  date: string
) => PayArrangement | null;

/**
 * Minimal PostgREST emulator — adapted from `payArrangementRepository.test.ts`
 * (which is where this pattern comes from).
 *
 * WHY BOTH COPIES COMPARE INSTANTS: the sibling file's `order` originally
 * compared values as STRINGS — writing these vectors is what exposed it, and
 * it has since been fixed there too (`payArrangementRepository.test.ts:63-79`),
 * so the two emulators now agree. Do not "restore" a string compare in either.
 * For `valid_from` (a `date` column, always `YYYY-MM-DD`) the two are
 * indistinguishable. For `created_at` they are NOT —
 * `timestamptz` is ordered by INSTANT in Postgres, and the same instant has
 * two legal ISO-8601 spellings (`+00:00` from PostgREST, `.000Z` from
 * `toISOString()`; GOLDEN-FIXES #25). A string sort therefore models a
 * database that does not exist, and the #25 vectors below — the whole reason
 * this file has to exist — would be graded against a fiction. So this copy
 * compares anything date-parseable as an instant and falls back to a string
 * compare otherwise, which is what `order by … desc` actually does.
 * Equal instants tie, and `Array.prototype.sort` is stable, so a tie keeps
 * input order — Postgres's own choice there is arbitrary, and the
 * serialisation-independence test at the bottom is what pins the part that
 * IS well-defined.
 */
function createFakeQuery(rows: FakeRow[], error: unknown = null): any {
  const eqFilters: [string, unknown][] = [];
  const lteFilters: [string, string][] = [];
  const orderKeys: [string, boolean][] = [];
  let rowLimit: number | null = null;
  const orGroups: { column: string; op: string; value?: string }[][] = [];

  const compare = (left: string, right: string): number => {
    const leftMs = Date.parse(left);
    const rightMs = Date.parse(right);
    if (!(Number.isNaN(leftMs) || Number.isNaN(rightMs))) {
      return leftMs === rightMs ? 0 : leftMs < rightMs ? -1 : 1;
    }
    if (left === right) return 0;
    return left < right ? -1 : 1;
  };

  const resolveRows = (): FakeRow[] => {
    let out = rows.filter(
      row =>
        eqFilters.every(([key, value]) => row[key] === value) &&
        lteFilters.every(([key, value]) => String(row[key]) <= value) &&
        orGroups.every(branches =>
          branches.some(({ column, op, value }) =>
            op === 'is'
              ? (row[column] ?? null) === null
              : row[column] != null && String(row[column]) >= String(value)
          )
        )
    );
    for (const [key, ascending] of [...orderKeys].reverse()) {
      out = [...out].sort(
        (a, b) => compare(String(a[key]), String(b[key])) * (ascending ? 1 : -1)
      );
    }
    if (rowLimit !== null) out = out.slice(0, rowLimit);
    return out;
  };

  const chain: any = {
    select: mock(() => chain),
    eq: mock((key: string, value: unknown) => {
      eqFilters.push([key, value]);
      return chain;
    }),
    lte: mock((key: string, value: string) => {
      lteFilters.push([key, value]);
      return chain;
    }),
    order: mock((key: string, opts?: { ascending?: boolean }) => {
      orderKeys.push([key, opts?.ascending !== false]);
      return chain;
    }),
    limit: mock((count: number) => {
      rowLimit = count;
      return chain;
    }),
    // 065's exclusion: `.or('valid_to.is.null,valid_to.gte.<date>')`.
    or: mock((expression: string) => {
      orGroups.push(
        expression.split(',').map(branch => {
          const [column = '', op = '', value] = branch.split('.');
          return { column, op, value };
        })
      );
      return chain;
    }),
    maybeSingle: mock(async () => {
      const found = resolveRows();
      return { data: error ? null : (found[0] ?? null), error };
    }),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : resolveRows(), error }).then(
        resolve
      ),
  };
  return chain;
}

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
  mock.module('../../../../../src/config/supabase', () => {
    const obj = { from: mock(() => createFakeQuery([])) };
    return { supabase: obj, supabaseService: obj };
  });

  PayArrangementRepository = (
    await import(
      '../../../../../src/domains/pay/repositories/payArrangementRepository'
    )
  ).PayArrangementRepository;
  engineEffectiveOn = (
    await import('../../../../../src/domains/pay/services/earningsService')
  ).effectiveOn;
  mockSupabaseService = (await import('../../../../../src/config/supabase'))
    .supabaseService;
});

/** The repository's answer for a vector — the SQL side. */
async function resolveViaRepository(
  rows: FakeRow[],
  date: string
): Promise<string | null> {
  mockSupabaseService.from.mockImplementation(() => createFakeQuery(rows));
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
   * genuinely undefined — Postgres's `order by … desc` makes an arbitrary
   * choice between equal keys — so there is no id to pin. What IS defined is
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
