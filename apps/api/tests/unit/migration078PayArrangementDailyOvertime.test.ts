/**
 * @module tests/unit/migration078PayArrangementDailyOvertime.test
 * Pattern A — migration contract for `078_pay_arrangement_daily_overtime.sql`.
 *
 * WHAT THIS PINS, and why each one is silent when broken:
 *
 *  1. **Five nullable columns, no backfill, no default.** A pre-078
 *     arrangement must keep reading as "weekly overtime only" — the terms it
 *     was actually agreed under. A DEFAULT here would retroactively promise
 *     daily overtime to every family in the table, which is the app inventing
 *     a statutory term for a household it knows nothing about (§5 D-7's whole
 *     liability posture, inverted).
 *  2. **The seventh day is three values, not a boolean**
 *     (`docs/design/screens-pay-terms.md` §3, owner decision D2). A boolean
 *     can only say "on", which prices a long seventh day at a flat 1.5x and
 *     underpays it. This test is here so nobody "simplifies" it back.
 *  3. **Ordered daily tiers.** "Double time after 6h, overtime after 8h" is a
 *     typo or a term nobody meant. Refuse, never clamp (playbook §2.9) — and
 *     Postgres is the last place that can still say no, because the engine
 *     downstream will happily produce a self-consistent wrong number from an
 *     inverted pair.
 *  4. **A tier that pays double time has a multiplier to pay it at.** Without
 *     the pairing checks a row can name a double-time threshold with no rate,
 *     and the only honest thing the engine can then do is not pay it — money
 *     silently missing from a week, which is the failure mode this whole
 *     table's constraints exist to prevent.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dir, '../../../../supabase/migrations');
const MIGRATION = '078_pay_arrangement_daily_overtime.sql';

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
  .toLowerCase();

const commentText = migrationSql
  .split('\n')
  .filter(line => line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const NEW_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['overtime_daily_threshold_minutes', 'integer'],
  ['doubletime_daily_threshold_minutes', 'integer'],
  ['doubletime_multiplier', 'numeric(3, 2)'],
  ['seventh_day_multiplier', 'numeric(3, 2)'],
  ['seventh_day_doubletime_after_minutes', 'integer'],
];

describe('078 — the five new columns', () => {
  for (const [column, type] of NEW_COLUMNS) {
    it(`adds ${column} as a nullable ${type}`, () => {
      expect(executable).toContain(
        `alter table public.pay_arrangements add column if not exists ${column} ${type}`
      );
    });

    it(`leaves ${column} nullable — null is an explicit "no such tier"`, () => {
      expect(executable).not.toContain(`${column} ${type} not null`);
    });

    it(`gives ${column} no default — 078 promises nothing to an existing row`, () => {
      expect(executable).not.toContain(`${column} ${type} default`);
    });
  }

  it('backfills nothing — every pre-078 arrangement stays weekly-overtime-only', () => {
    expect(executable).not.toContain('update public.pay_arrangements set');
  });

  it('adds no new RLS policy — 041 already scopes this row', () => {
    expect(executable).not.toContain('create policy');
    expect(executable).not.toContain(
      'alter table public.pay_arrangements enable row level security'
    );
  });
});

describe('078 — the seventh day is three values, not a boolean (§3, D2)', () => {
  it('stores a seventh-day MULTIPLIER, never a flag', () => {
    expect(executable).toContain('seventh_day_multiplier numeric(3, 2)');
    expect(executable).not.toContain('seventh_day_overtime boolean');
    expect(executable).not.toContain('boolean');
  });

  it('stores a second-tier threshold so a long seventh day can reach double time', () => {
    expect(executable).toContain(
      'seventh_day_doubletime_after_minutes integer'
    );
  });

  it('documents why a boolean was rejected', () => {
    expect(commentText).toContain('boolean');
    expect(commentText).toContain('two tiers');
  });
});

describe('078 — domain floors, in 041’s style', () => {
  const floors: ReadonlyArray<readonly [string, string]> = [
    [
      'pay_arrangements_overtime_daily_threshold_positive',
      'overtime_daily_threshold_minutes > 0',
    ],
    [
      'pay_arrangements_doubletime_daily_threshold_positive',
      'doubletime_daily_threshold_minutes > 0',
    ],
    [
      'pay_arrangements_doubletime_multiplier_min',
      'doubletime_multiplier >= 1',
    ],
    [
      'pay_arrangements_seventh_day_multiplier_min',
      'seventh_day_multiplier >= 1',
    ],
    [
      'pay_arrangements_seventh_day_doubletime_after_positive',
      'seventh_day_doubletime_after_minutes > 0',
    ],
  ];

  for (const [name, predicate] of floors) {
    it(`checks ${predicate}`, () => {
      expect(executable).toContain(
        `add constraint ${name} check (${predicate})`
      );
    });

    it(`drops ${name} before adding it — the house idempotency pattern`, () => {
      const dropAt = executable.indexOf(`drop constraint if exists ${name}`);
      const addAt = executable.indexOf(`add constraint ${name}`);
      expect(dropAt).toBeGreaterThanOrEqual(0);
      expect(addAt).toBeGreaterThan(dropAt);
    });
  }
});

describe('078 — the cross-column rules', () => {
  it('refuses inverted daily tiers: double time must come AFTER daily overtime', () => {
    expect(executable).toContain(
      'add constraint pay_arrangements_daily_tiers_ordered check ( doubletime_daily_threshold_minutes is null or overtime_daily_threshold_minutes is null or doubletime_daily_threshold_minutes > overtime_daily_threshold_minutes )'
    );
  });

  it('is not satisfied by >=  — equal thresholds would make the middle tier empty', () => {
    expect(executable).not.toContain(
      'doubletime_daily_threshold_minutes >= overtime_daily_threshold_minutes'
    );
  });

  it('refuses a daily double-time threshold with no multiplier to pay it at', () => {
    expect(executable).toContain(
      'add constraint pay_arrangements_doubletime_daily_needs_multiplier check ( doubletime_daily_threshold_minutes is null or doubletime_multiplier is not null )'
    );
  });

  it('refuses a seventh-day second tier with no rule and no multiplier behind it', () => {
    expect(executable).toContain(
      'add constraint pay_arrangements_seventh_day_second_tier_needs_multiplier check ( seventh_day_doubletime_after_minutes is null or ( seventh_day_multiplier is not null and doubletime_multiplier is not null ) )'
    );
  });
});

describe('078 — documentation contract', () => {
  const phrases = [
    // Null means an explicit no, on every one of the five.
    'null = no daily overtime tier',
    'null = no seventh-day rule',
    // The engine reads numbers off the row; presets are data that fill them.
    'a jurisdiction preset is a data file that populates them',
    // Why one multiplier serves both double-time tiers.
    'two columns holding the same',
    // The house rule the ordering check enforces.
    'refuse, never',
  ];

  for (const phrase of phrases) {
    it(`documents "${phrase}" in a comment`, () => {
      expect(commentText).toContain(phrase);
    });
  }

  it('names 041 as the table it extends and 041’s own forward reference', () => {
    expect(commentText).toContain('041');
    expect(commentText).toContain('hardcodes 40 hours');
  });
});
