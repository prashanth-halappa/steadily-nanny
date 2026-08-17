/**
 * `DefaultReminderCandidateSource.listScheduleNotSet` — the six firing
 * conditions that live in the query rather than in the hour gate.
 *
 * Its own file because `mock.module` on the Supabase client must land before
 * `reminderJob` is imported; the injected-seam behaviour is covered in
 * `reminderJob.scheduleNotSet.test.ts`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ScheduleNotSetCandidate } from '../../../src/jobs/reminderJob';

const CARER_ID = 'carer-11111111-1111-1111-1111-111111111111';
const OTHER_CARER_ID = 'carer-22222222-2222-2222-2222-222222222222';
const HOUSEHOLD_ID = 'house-11111111-1111-1111-1111-111111111111';

const NOW = new Date('2026-08-05T16:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Rows each table returns on this run — set per test. */
const rows: Record<string, unknown[]> = {};
let calls: RecordedCall[] = [];

// biome-ignore lint/suspicious/noExplicitAny: mocked supabase chain
function createChain(table: string): any {
  const record =
    (method: string) =>
    // biome-ignore lint/suspicious/noExplicitAny: mocked supabase chain
    (...args: unknown[]): any => {
      calls.push({ table, method, args });
      return chain;
    };
  // biome-ignore lint/suspicious/noExplicitAny: mocked supabase chain
  const chain: any = {
    select: record('select'),
    eq: record('eq'),
    in: record('in'),
    not: record('not'),
    lte: record('lte'),
    gte: record('gte'),
    or: record('or'),
    order: record('order'),
    limit: record('limit'),
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
  };
  return chain;
}

let listScheduleNotSet: (now: Date) => Promise<ScheduleNotSetCandidate[]>;

beforeAll(async () => {
  mock.module('../../../src/config/supabase', () => {
    const obj = { from: mock((table: string) => createChain(table)) };
    return { supabase: obj, supabaseService: obj };
  });

  const mod = await import('../../../src/jobs/reminderJob');
  const source = new mod.DefaultReminderCandidateSource();
  listScheduleNotSet = (now: Date) => source.listScheduleNotSet(now);
});

/** An active nanny in a live household — condition 1 and 2 satisfied. */
function activeNannyRow(overrides: Record<string, unknown> = {}) {
  return {
    household_id: HOUSEHOLD_ID,
    user_id: CARER_ID,
    display_name_override: null,
    ...overrides,
  };
}

/** A current arrangement — condition 3 satisfied. */
function arrangementRow(overrides: Record<string, unknown> = {}) {
  return {
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    carer_display_name: 'Marisol',
    ...overrides,
  };
}

function callsFor(table: string, method: string): RecordedCall[] {
  return calls.filter(c => c.table === table && c.method === method);
}

beforeEach(() => {
  calls = [];
  rows.household_members = [];
  rows.pay_arrangements = [];
  rows.schedule_patterns = [];
});

describe('DefaultReminderCandidateSource.listScheduleNotSet', () => {
  it('returns the pair when every condition holds', async () => {
    rows.household_members = [activeNannyRow()];
    rows.pay_arrangements = [arrangementRow()];

    expect(await listScheduleNotSet(NOW)).toEqual([
      {
        household_id: HOUSEHOLD_ID,
        carer_id: CARER_ID,
        carer_display_name: 'Marisol',
      },
    ]);
  });

  // Conditions 1 and 2: a live household with an ACTIVE nanny. Both are
  // filters on the first query, so assert the filters rather than trusting
  // that a fake with no rows proves anything.
  it('asks only for active nannies in live households', async () => {
    await listScheduleNotSet(NOW);

    const select = callsFor('household_members', 'select')[0];
    expect(String(select?.args[0])).toContain('households!inner(state)');

    const eqs = callsFor('household_members', 'eq').map(c => c.args);
    expect(eqs).toContainEqual(['role', 'nanny']);
    expect(eqs).toContainEqual(['status', 'active']);
    expect(eqs).toContainEqual(['households.state', 'live']);
  });

  it('yields nothing when the household has no active nanny', async () => {
    rows.pay_arrangements = [arrangementRow()];

    expect(await listScheduleNotSet(NOW)).toEqual([]);
    // Nothing to look up terms for, so it must not even ask.
    expect(callsFor('pay_arrangements', 'select')).toHaveLength(0);
  });

  it('yields nothing when no arrangement exists for the pair', async () => {
    rows.household_members = [activeNannyRow()];

    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  // Condition 5: terms are often agreed the same day the family already
  // talked the schedule through out loud — day 0 is not a stall.
  it('ignores arrangements younger than a day', async () => {
    rows.household_members = [activeNannyRow()];
    await listScheduleNotSet(NOW);

    expect(callsFor('pay_arrangements', 'lte')[0]?.args).toEqual([
      'created_at',
      new Date(NOW.getTime() - MS_PER_DAY).toISOString(),
    ]);
  });

  // Condition 4: STARTING the builder proves she found it, so any pattern row
  // suppresses this forever — `draft` included, which is the status a
  // half-built week sits in and the easy one to get wrong.
  it('suppresses forever once a pattern exists for the pair', async () => {
    rows.household_members = [activeNannyRow()];
    rows.pay_arrangements = [arrangementRow()];
    rows.schedule_patterns = [
      { household_id: HOUSEHOLD_ID, carer_id: CARER_ID },
    ];

    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  // The status arm of condition 4 is enforced by ASKING FOR NO STATUS. A
  // filter here would be the bug: `draft` is exactly the status that must
  // suppress, and it is the one a status filter would most plausibly omit.
  it('never filters schedule_patterns by status', async () => {
    rows.household_members = [activeNannyRow()];
    rows.pay_arrangements = [arrangementRow()];
    await listScheduleNotSet(NOW);

    const eqs = callsFor('schedule_patterns', 'eq').map(c => c.args[0]);
    expect(eqs).not.toContain('status');
  });

  // 014's column comment: a parent can sketch a usual week before any nanny
  // exists, leaving `carer_id` null. That still proves the builder was found,
  // so it suppresses every carer in that household.
  it('treats an unassigned household pattern as proof the builder was found', async () => {
    rows.household_members = [activeNannyRow()];
    rows.pay_arrangements = [arrangementRow()];
    rows.schedule_patterns = [{ household_id: HOUSEHOLD_ID, carer_id: null }];

    expect(await listScheduleNotSet(NOW)).toEqual([]);
  });

  it('does not let one carer’s pattern suppress a second carer', async () => {
    rows.household_members = [
      activeNannyRow(),
      activeNannyRow({ user_id: OTHER_CARER_ID }),
    ];
    rows.pay_arrangements = [
      arrangementRow(),
      arrangementRow({ carer_id: OTHER_CARER_ID, carer_display_name: 'Ada' }),
    ];
    rows.schedule_patterns = [
      { household_id: HOUSEHOLD_ID, carer_id: CARER_ID },
    ];

    expect(await listScheduleNotSet(NOW)).toEqual([
      {
        household_id: HOUSEHOLD_ID,
        carer_id: OTHER_CARER_ID,
        carer_display_name: 'Ada',
      },
    ]);
  });

  // Same precedence `resolveCarerDisplayName` uses in the pay domain: the
  // per-household override is what this family calls her.
  it('prefers the household display-name override over the stored name', async () => {
    rows.household_members = [
      activeNannyRow({ display_name_override: 'Mari' }),
    ];
    rows.pay_arrangements = [arrangementRow()];

    expect((await listScheduleNotSet(NOW))[0]?.carer_display_name).toBe('Mari');
  });
});
