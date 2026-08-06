/**
 * @module tests/unit/migration055TimeEntryOverlapExclusion.test
 * Pattern A — migration contract for `055_time_entry_overlap_exclusion.sql`.
 *
 * Written BEFORE the migration existed, same discipline as 049/052/053/054.
 *
 * Closes the race 053's header documented and could not fix: two concurrent
 * paid-cancellation accepts compute DIFFERENT remainders (she clocks in
 * between the two reads), so their `clock_in_at` values differ, so 053's
 * `(shift_id, clock_in_at)` unique index does not collide — and the household
 * pays twice for overlapping minutes. It also gives `assertNoOverlap` its
 * first database backstop; until now the app check was the only thing
 * preventing overlapping entries anywhere.
 *
 * The constraint mirrors `assertNoOverlap` deliberately:
 *   - carer-scoped (`carer_id with =`) — that method takes a carerId;
 *   - kind-agnostic — it never looks at `kind`;
 *   - skips rows with a null `clock_in_at` — it `continue`s on them;
 *   - half-open `[)` — `spansOverlap` is `aIn < bOut && bIn < aOut`, so
 *     touching end-to-start is NOT an overlap, and `tstzrange`'s two-argument
 *     form defaults to `[)`. Passing an explicit '[]' would reject a shift
 *     ending at 16:00 followed by one starting at 16:00.
 *
 * RUNNING ENTRIES ARE OUT OF SCOPE, deliberately: `tstzrange(x, null)` is
 * unbounded above, so a running entry would conflict with every later entry
 * and break legitimate retroactive writes. The partial predicate covers
 * completed-vs-completed only — which is the money case and the whole of the
 * 053 race — and leaves running-vs-completed to `spansOverlap`, which already
 * handles the null arm.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '055_time_entry_overlap_exclusion.sql';
/** Carer-global, but only for time actually on the clock. */
const CARER_CONSTRAINT = 'time_entries_no_clock_overlap_per_carer';
/** Any kind, but only within one household. */
const HOUSEHOLD_CONSTRAINT = 'time_entries_no_overlap_per_household';

function readMigration(name: string): string {
  const path = join(migrationsDir, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Migration file not found: ${path}`);
  }
}

const migrationSql = readMigration(MIGRATION);

/** Executable SQL only — `--` comment lines dropped, whitespace collapsed. */
const executable = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ')
  .replace(/\(\s+/g, '(')
  .replace(/\s+\)/g, ')')
  .toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('055 — installs btree_gist', () => {
  // A gist exclusion mixing an equality column with a range needs btree_gist
  // for the `=` operator class. Without it the ALTER fails.
  it('creates the extension', () => {
    expect(executable).toContain('create extension if not exists btree_gist');
  });

  it('creates it before the constraint that needs it', () => {
    expect(executable.indexOf('create extension')).toBeLessThan(
      executable.indexOf('add constraint')
    );
  });
});

describe('055 — the two exclusion constraints', () => {
  it('adds exactly two constraints, both EXCLUDE USING GIST', () => {
    expect(executable.match(/add constraint/g)).toHaveLength(2);
    expect(executable.match(/exclude using gist/g)).toHaveLength(2);
  });

  it('scopes both to one carer with =', () => {
    expect(executable.match(/carer_id with =/g)).toHaveLength(2);
  });

  it('rejects overlapping clock spans with && in both', () => {
    expect(
      executable.match(/tstzrange\(clock_in_at, clock_out_at\) with &&/g)
    ).toHaveLength(2);
  });

  // The whole point of splitting into two: cancellation pay compensates a
  // household for a booking it broke, so it is not presence and must not
  // participate in the carer-global rule.
  it('exempts cancellation_paid from the carer-global constraint', () => {
    expect(executable).toContain("kind <> 'cancellation_paid'");
  });

  // manual_adjustment IS worked time (timesheet.schema.ts: "a correction of
  // worked time"; earnings banks worked = worked + manual_adjustment). Keying
  // on `kind = 'worked'` would let a manual_adjustment for one household
  // overlap worked time for another — the same impossibility, relabelled.
  it('does not key the carer constraint on kind = worked', () => {
    expect(executable).not.toContain("kind = 'worked'");
  });

  it('scopes the second constraint to one household', () => {
    expect(executable).toContain('household_id with =');
    expect(executable.match(/household_id with =/g)).toHaveLength(1);
  });

  // `spansOverlap` is `aIn < bOut && bIn < aOut` — touching is not
  // overlapping. tstzrange's 2-arg form is already `[)`; an explicit third
  // argument is the way to get this wrong.
  it('leaves tstzrange on its default [) bounds', () => {
    expect(executable).not.toContain("'[]'");
    expect(executable).not.toContain("'()'");
    expect(executable).not.toContain("'(]'");
    expect(executable).not.toContain("clock_out_at, '[)'");
  });

  it('is partial on both timestamps being present, in both constraints', () => {
    expect(executable.match(/clock_in_at is not null/g)).toHaveLength(2);
    expect(executable.match(/clock_out_at is not null/g)).toHaveLength(2);
  });

  // Fragments of one remainder are disjoint, so each statement satisfies the
  // constraint on its own; deferring would only delay the error to COMMIT and
  // lose the statement that caused it.
  it('is not deferrable', () => {
    expect(executable).not.toContain('deferrable');
  });

  it('drops each constraint before adding it, the house idempotency pattern', () => {
    for (const name of [CARER_CONSTRAINT, HOUSEHOLD_CONSTRAINT]) {
      expect(executable).toContain(`drop constraint if exists ${name}`);
      expect(
        executable.indexOf(`drop constraint if exists ${name}`)
      ).toBeLessThan(executable.indexOf(`add constraint ${name}`));
    }
  });

  it('names both constraints predictably', () => {
    expect(executable).toContain(`add constraint ${CARER_CONSTRAINT}`);
    expect(executable).toContain(`add constraint ${HOUSEHOLD_CONSTRAINT}`);
  });
});

/**
 * The derivation, executable. String-matching the SQL proves the predicates
 * are written; this proves they COMPOSE into the agreed permission table. The
 * two functions below mirror the two `where` clauses — an exclusion constraint
 * fires only when BOTH rows are in its partial index and the ranges overlap.
 */
describe('055 — the two constraints reproduce the permission table', () => {
  interface Row {
    kind: 'worked' | 'cancellation_paid' | 'manual_adjustment';
    household: 'h1' | 'h2';
  }

  const carerConstraintFires = (a: Row, b: Row): boolean =>
    a.kind !== 'cancellation_paid' && b.kind !== 'cancellation_paid';

  const householdConstraintFires = (a: Row, b: Row): boolean =>
    a.household === b.household;

  /** Same carer, overlapping spans, both completed — refused by either. */
  const refused = (a: Row, b: Row): boolean =>
    carerConstraintFires(a, b) || householdConstraintFires(a, b);

  const W = (household: 'h1' | 'h2'): Row => ({ kind: 'worked', household });
  const C = (household: 'h1' | 'h2'): Row => ({
    kind: 'cancellation_paid',
    household,
  });
  const M = (household: 'h1' | 'h2'): Row => ({
    kind: 'manual_adjustment',
    household,
  });

  const TABLE: ReadonlyArray<readonly [string, Row, Row, boolean]> = [
    [
      'worked h1 vs worked h1 — one family banking twice',
      W('h1'),
      W('h1'),
      true,
    ],
    [
      'worked h1 vs worked h2 — cannot be in two places',
      W('h1'),
      W('h2'),
      true,
    ],
    [
      'worked h1 vs cancellation h1 — same window paid twice',
      W('h1'),
      C('h1'),
      true,
    ],
    ['worked h1 vs cancellation h2 — THE £120 CASE', W('h1'), C('h2'), false],
    ['cancellation h1 vs cancellation h2 — both owe', C('h1'), C('h2'), false],
    [
      'cancellation h1 vs worked h2 — same ruling, reversed',
      C('h1'),
      W('h2'),
      false,
    ],
    [
      'cancellation h1 vs cancellation h1 — one family, twice',
      C('h1'),
      C('h1'),
      true,
    ],
    // manual_adjustment is worked time, so it behaves as `worked` throughout.
    [
      'adjustment h1 vs worked h2 — relabelled presence',
      M('h1'),
      W('h2'),
      true,
    ],
    [
      'adjustment h1 vs cancellation h2 — still permitted',
      M('h1'),
      C('h2'),
      false,
    ],
    [
      'adjustment h1 vs cancellation h1 — one family, twice',
      M('h1'),
      C('h1'),
      true,
    ],
  ];

  for (const [label, a, b, expected] of TABLE) {
    it(`${expected ? 'REFUSES' : 'PERMITS'}: ${label}`, () => {
      expect(refused(a, b)).toBe(expected);
      // Order must not matter — the constraint sees an unordered pair.
      expect(refused(b, a)).toBe(expected);
    });
  }
});

describe('055 — changes nothing else', () => {
  it('touches no policy, index, trigger or function', () => {
    for (const forbidden of [
      'create policy',
      'drop policy',
      'create index',
      'drop index',
      'create trigger',
      'create or replace function',
      'create table',
    ]) {
      expect(executable).not.toContain(forbidden);
    }
  });

  it('deletes no data', () => {
    expect(executable).not.toContain('delete from');
    expect(executable).not.toContain('truncate');
    expect(executable).not.toContain('update public.');
  });

  // 053's unique index is a different rule (identical-span dedupe per shift)
  // and stays: this constraint is carer-scoped and cannot see shift_id.
  it('does not drop 053’s per-span unique index', () => {
    expect(executable).not.toContain(
      'time_entries_one_cancellation_paid_per_span'
    );
  });
});

describe('055 — documentation contract', () => {
  const REQUIRED_HEADER_PHRASES = [
    // The defect being closed.
    'different remainders',
    'twice',
    '053',
    // The ruling that split one constraint into two.
    'not presence',
    'permission table',
    'manual_adjustment is worked time',
    // The running-entry decision and its reason.
    'unbounded',
    'running',
    // Bounds.
    'half-open',
    'spansoverlap',
    // The app check stays.
    'assertnooverlap',
    'backstop',
    // Deploy risk: pre-existing violations block the ALTER.
    'pre-existing',
  ] as const;

  for (const phrase of REQUIRED_HEADER_PHRASES) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }
});
