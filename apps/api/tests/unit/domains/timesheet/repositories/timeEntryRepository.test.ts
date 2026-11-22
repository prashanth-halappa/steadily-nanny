/**
 * TimeEntryRepository against a real Miniflare D1 (tests/helpers/testDb.ts).
 * Real predicates instead of a recording chain, so an inverted comparison or a
 * missing carer filter fails (F-B1-1, F-B1-3); plus the app-side `local_date`
 * derivation that replaced the `sync_time_entries_local_date` trigger.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  households,
  shifts,
  timeEntries,
  user,
  userProfiles,
} from '../../../../../src/db/schema';
import { DatabaseError } from '../../../../../src/errors';
import { createTestDb, type TestDb } from '../../../../helpers/testDb';

let t: TestDb;
let TimeEntryRepository: typeof import('../../../../../src/domains/timesheet/repositories/timeEntryRepository').TimeEntryRepository;
let AlreadyClockedInError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').AlreadyClockedInError;
let CancellationPaidAlreadyRecordedError: typeof import('../../../../../src/domains/timesheet/errors/timesheetErrors').CancellationPaidAlreadyRecordedError;

const H1 = 'h1';
const H2 = 'h2';
const C1 = 'carer-1';
const C2 = 'carer-2';
const NY = 'America/New_York';
const LONDON = 'Europe/London';

beforeAll(async () => {
  t = await createTestDb();
  mock.module('../../../../../src/db/client', () => ({ db: t.db }));
  ({ TimeEntryRepository } = await import(
    '../../../../../src/domains/timesheet/repositories/timeEntryRepository'
  ));
  ({ AlreadyClockedInError, CancellationPaidAlreadyRecordedError } =
    await import(
      '../../../../../src/domains/timesheet/errors/timesheetErrors'
    ));

  for (const id of [C1, C2]) {
    await t.db.insert(user).values({ id, name: id, email: `${id}@x.test` });
    await t.db.insert(userProfiles).values({ user_id: id });
  }
  await t.db.insert(households).values([
    { id: H1, name: 'One' },
    { id: H2, name: 'Two' },
  ]);
  await t.db.insert(shifts).values(
    ['s1', 's2', 's3', 's4', 's5'].map((id, i) => ({
      id,
      household_id: H1,
      starts_at: `2020-01-1${i}T08:00:00.000Z`,
      ends_at: `2020-01-1${i}T16:00:00.000Z`,
      timezone: LONDON,
      local_date: `2020-01-1${i}`,
    }))
  );
});
afterAll(() => t.dispose());

type Insert = typeof timeEntries.$inferInsert;

/** Raw seed for read-path tests; local_date given explicitly. */
async function seed(row: Partial<Insert> & { id: string }) {
  await t.db.insert(timeEntries).values({
    household_id: H1,
    carer_id: C1,
    carer_display_name: 'Carer',
    timezone: LONDON,
    local_date: '2026-08-03',
    status: 'submitted',
    ...row,
  });
}

const submitted = (over: Record<string, unknown> = {}) => ({
  household_id: H1,
  carer_id: C1,
  carer_display_name: 'Carer',
  shift_id: null,
  clock_in_at: '2026-09-01T08:00:00.000Z',
  clock_out_at: '2026-09-01T12:00:00.000Z',
  break_minutes: 0,
  scheduled_minutes: null,
  timezone: LONDON,
  kind: 'worked' as const,
  status: 'submitted' as const,
  ...over,
});

const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort();

describe('clockIn', () => {
  it('creates a running entry with local_date derived from clock_in_at in its timezone', async () => {
    const repo = new TimeEntryRepository();
    // 02:00 UTC on the 10th is still the 9th in New York.
    const row = await repo.clockIn({
      household_id: H2,
      carer_id: C2,
      carer_display_name: 'Two',
      shift_id: null,
      clock_in_at: '2026-10-10T02:00:00.000Z',
      observed_clock_in_at: '2026-10-10T02:00:00.000Z',
      timezone: NY,
      kind: 'worked',
      status: 'running',
    });
    expect(row).toMatchObject({ status: 'running', local_date: '2026-10-09' });
  });

  it('turns the one-running-per-carer unique violation into AlreadyClockedInError', async () => {
    const err = await new TimeEntryRepository()
      .clockIn({
        household_id: H1,
        carer_id: C2,
        carer_display_name: 'Two',
        shift_id: null,
        clock_in_at: '2026-10-11T09:00:00.000Z',
        timezone: LONDON,
        kind: 'worked',
        status: 'running',
      })
      .catch(e => e);
    expect(err).toBeInstanceOf(AlreadyClockedInError);
  });
});

describe('update — local_date re-derivation', () => {
  it('a clock-out after midnight keeps the clock-in day', async () => {
    const repo = new TimeEntryRepository();
    const running = await repo.findRunningForCarer(C2);
    if (!running) throw new Error('expected the running entry');
    const out = await repo.update(running.id, {
      clock_out_at: '2026-10-10T07:00:00.000Z',
      status: 'submitted',
    });
    expect(out.local_date).toBe('2026-10-09');
  });

  it('moving clock_in_at re-derives local_date', async () => {
    const repo = new TimeEntryRepository();
    const row = await repo.createSubmitted(
      submitted({
        clock_in_at: '2026-09-02T10:00:00.000Z',
        clock_out_at: '2026-09-02T12:00:00.000Z',
      })
    );
    expect(row.local_date).toBe('2026-09-02');
    const moved = await repo.update(row.id, {
      clock_in_at: '2026-09-01T22:30:00.000Z',
    });
    expect(moved.local_date).toBe('2026-09-01');
    // ...and a timezone change alone re-derives it from the stored clock.
    const tz = await repo.update(row.id, { timezone: 'Asia/Tokyo' });
    expect(tz.local_date).toBe('2026-09-02');
  });

  it('a patch that touches no clock leaves local_date alone', async () => {
    const repo = new TimeEntryRepository();
    const row = await repo.createSubmitted(
      submitted({
        clock_in_at: '2026-09-03T10:00:00.000Z',
        clock_out_at: '2026-09-03T12:00:00.000Z',
      })
    );
    const noted = await repo.update(row.id, { note: 'hi' });
    expect(noted).toMatchObject({ note: 'hi', local_date: '2026-09-03' });
  });

  it('still throws for a missing row', async () => {
    const err = await new TimeEntryRepository()
      .update('missing', { clock_out_at: '2026-09-03T12:00:00.000Z' })
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
  });
});

describe('createSubmitted', () => {
  it('derives local_date from clock_in_at', async () => {
    const row = await new TimeEntryRepository().createSubmitted(
      submitted({
        clock_in_at: '2026-09-04T23:30:00.000Z',
        clock_out_at: '2026-09-05T03:00:00.000Z',
      })
    );
    expect(row.local_date).toBe('2026-09-05'); // BST: 00:30 on the 5th
  });

  it('a duplicate cancellation_paid span → CancellationPaidAlreadyRecordedError', async () => {
    const repo = new TimeEntryRepository();
    const span = submitted({
      carer_id: C2,
      shift_id: 's1',
      kind: 'cancellation_paid',
      clock_in_at: '2026-09-10T08:00:00.000Z',
      clock_out_at: '2026-09-10T16:00:00.000Z',
    });
    await repo.createSubmitted(span);
    const err = await repo.createSubmitted(span).catch(e => e);
    expect(err).toBeInstanceOf(CancellationPaidAlreadyRecordedError);
  });

  it('any other failure is a DatabaseError', async () => {
    const err = await new TimeEntryRepository()
      .createSubmitted(submitted({ break_minutes: -1 }))
      .catch(e => e);
    expect(err).toBeInstanceOf(DatabaseError);
  });
});

describe('voidById', () => {
  it('voids once, then returns null', async () => {
    await seed({
      id: 'v1',
      clock_in_at: '2025-01-01T08:00:00.000Z',
      clock_out_at: '2025-01-01T09:00:00.000Z',
    });
    const repo = new TimeEntryRepository();
    expect((await repo.voidById('v1'))?.status).toBe('voided');
    expect(await repo.voidById('v1')).toBeNull();
  });
});

describe('cancellation-paid lookups (069: voided is not pay)', () => {
  beforeAll(async () => {
    const base = {
      kind: 'cancellation_paid',
      clock_out_at: '2025-02-01T16:00:00.000Z',
      carer_id: null,
    } as const;
    await seed({
      id: 'cp-void',
      shift_id: 's2',
      clock_in_at: '2025-02-01T08:00:00.000Z',
      status: 'voided',
      ...base,
    });
    await seed({
      id: 'cp-a',
      shift_id: 's3',
      clock_in_at: '2025-02-01T08:00:00.000Z',
      ...base,
    });
    await seed({
      id: 'cp-b',
      shift_id: 's3',
      clock_in_at: '2025-02-01T12:00:00.000Z',
      ...base,
    });
  });

  it('findCancellationPaidForShift ignores voided rows and tolerates several fragments', async () => {
    const repo = new TimeEntryRepository();
    expect(await repo.findCancellationPaidForShift('s2')).toBeNull();
    expect(['cp-a', 'cp-b']).toContain(
      (await repo.findCancellationPaidForShift('s3'))?.id ?? ''
    );
  });

  it('findCancellationPaidForSpan picks the fragment by clock_in_at, never a voided one', async () => {
    const repo = new TimeEntryRepository();
    expect(
      (await repo.findCancellationPaidForSpan('s3', '2025-02-01T12:00:00.000Z'))
        ?.id
    ).toBe('cp-b');
    expect(
      await repo.findCancellationPaidForSpan('s2', '2025-02-01T08:00:00.000Z')
    ).toBeNull();
  });
});

describe('running lookups', () => {
  it('findRunningForCarer is global; findRunningInHousehold is scoped to ONE household', async () => {
    const repo = new TimeEntryRepository();
    const running = await repo.clockIn({
      household_id: H2,
      carer_id: C1,
      carer_display_name: 'One',
      shift_id: null,
      clock_in_at: '2026-11-01T09:00:00.000Z',
      timezone: LONDON,
      kind: 'worked',
      status: 'running',
    });
    expect((await repo.findRunningForCarer(C1))?.id).toBe(running.id);
    expect((await repo.findRunningInHousehold(H2, C1))?.id).toBe(running.id);
    expect(await repo.findRunningInHousehold(H1, C1)).toBeNull();
    await repo.update(running.id, {
      clock_out_at: '2026-11-01T10:00:00.000Z',
      status: 'submitted',
    });
    expect(await repo.findRunningForCarer(C1)).toBeNull();
  });
});

describe('hasTimeEntries / shiftIdsWithTimeEntries (069: voided-only shifts un-freeze)', () => {
  it('answers per shift, excluding voided rows', async () => {
    const repo = new TimeEntryRepository();
    expect(await repo.hasTimeEntries('s3')).toBe(true);
    expect(await repo.hasTimeEntries('s2')).toBe(false);
    expect(await repo.hasTimeEntries('s5')).toBe(false);
  });

  it('returns the set in one pass, deduped, and asks nothing for an empty list', async () => {
    const repo = new TimeEntryRepository();
    expect(await repo.shiftIdsWithTimeEntries([])).toEqual(new Set());
    // >100 ids exercises the chunking under D1's bound-parameter cap.
    const many = [
      's1',
      's2',
      's3',
      ...Array.from({ length: 150 }, (_, i) => `x${i}`),
    ];
    expect(await repo.shiftIdsWithTimeEntries(many)).toEqual(
      new Set(['s1', 's3'])
    );
  });
});

describe('week listings', () => {
  beforeAll(async () => {
    const day = (d: string, h: number) =>
      `2026-08-0${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
    await seed({
      id: 'w-mon',
      household_id: H2,
      clock_in_at: day('3', 8),
      clock_out_at: day('3', 9),
      local_date: '2026-08-03',
      household_member_id: 'm1',
    });
    await seed({
      id: 'w-tue',
      household_id: H2,
      clock_in_at: day('4', 8),
      clock_out_at: day('4', 9),
      local_date: '2026-08-04',
    });
    await seed({
      id: 'w-adj',
      household_id: H2,
      kind: 'manual_adjustment',
      local_date: '2026-08-05',
    });
    await seed({
      id: 'w-void',
      household_id: H2,
      clock_in_at: day('5', 8),
      clock_out_at: day('5', 9),
      local_date: '2026-08-05',
      status: 'voided',
    });
    await seed({
      id: 'w-c2',
      household_id: H2,
      carer_id: C2,
      clock_in_at: day('6', 8),
      clock_out_at: day('6', 9),
      local_date: '2026-08-06',
    });
    await seed({
      id: 'w-next',
      household_id: H2,
      clock_in_at: '2026-08-10T08:00:00.000Z',
      clock_out_at: '2026-08-10T09:00:00.000Z',
      local_date: '2026-08-10',
    });
  });

  it('listForHouseholdWeek: [start, end), newest clock-in first (NULLs first, as Postgres), voided kept', async () => {
    const rows = await new TimeEntryRepository().listForHouseholdWeek(
      H2,
      '2026-08-03',
      '2026-08-10'
    );
    expect(rows.map(r => r.id)).toEqual([
      'w-adj',
      'w-c2',
      'w-void',
      'w-tue',
      'w-mon',
    ]);
    expect(rows.find(r => r.id === 'w-mon')?.household_member_id).toBe('m1');
  });

  it('listForHouseholdWeek narrows to one carer when given (F-B1-3)', async () => {
    const rows = await new TimeEntryRepository().listForHouseholdWeek(
      H2,
      '2026-08-03',
      '2026-08-10',
      C2
    );
    expect(ids(rows)).toEqual(['w-c2']);
  });

  it('listForCarerWeek scopes to household + carer', async () => {
    const repo = new TimeEntryRepository();
    expect(
      ids(await repo.listForCarerWeek(H2, C1, '2026-08-03', '2026-08-10'))
    ).toEqual(['w-adj', 'w-mon', 'w-tue', 'w-void']);
    expect(
      await repo.listForCarerWeek(H2, C1, '2030-01-07', '2030-01-14')
    ).toEqual([]);
  });
});

describe('listOverlapCandidatesForCarer', () => {
  beforeAll(async () => {
    await seed({
      id: 'o-overnight',
      clock_in_at: '2027-08-01T22:00:00.000Z',
      clock_out_at: '2027-08-02T05:00:00.000Z',
      local_date: '2027-08-01',
    });
    await seed({
      id: 'o-monday',
      clock_in_at: '2027-08-02T08:00:00.000Z',
      clock_out_at: '2027-08-02T16:00:00.000Z',
      local_date: '2027-08-02',
    });
    await seed({
      id: 'o-voided',
      clock_in_at: '2027-08-02T08:00:00.000Z',
      clock_out_at: '2027-08-02T16:00:00.000Z',
      local_date: '2027-08-02',
      status: 'voided',
    });
    await seed({
      id: 'o-other-carer',
      carer_id: C2,
      clock_in_at: '2027-08-02T08:00:00.000Z',
      clock_out_at: '2027-08-02T16:00:00.000Z',
      local_date: '2027-08-02',
    });
    await seed({
      id: 'o-other-household',
      household_id: H2,
      clock_in_at: '2027-08-02T17:00:00.000Z',
      clock_out_at: '2027-08-02T18:00:00.000Z',
      local_date: '2027-08-02',
    });
  });

  const span = (from: string, to: string) =>
    new TimeEntryRepository().listOverlapCandidatesForCarer(C1, from, to);

  it('finds an entry filed under the previous day whose span reaches into this one', async () => {
    expect(
      ids(await span('2027-08-02T04:00:00.000Z', '2027-08-02T04:30:00.000Z'))
    ).toEqual(['o-overnight']);
  });

  it('excludes voided and other carers, includes other households of the same carer', async () => {
    expect(
      ids(await span('2027-08-02T09:00:00.000Z', '2027-08-02T17:30:00.000Z'))
    ).toEqual(['o-monday', 'o-other-household']);
  });

  it('includes a still-running entry', async () => {
    await seed({
      id: 'o-running',
      clock_in_at: '2027-08-03T09:00:00.000Z',
      local_date: '2027-08-03',
      status: 'running',
    });
    expect(
      ids(await span('2027-08-03T12:00:00.000Z', '2027-08-03T13:00:00.000Z'))
    ).toEqual(['o-running']);
    await t.db.delete(timeEntries).where(eq(timeEntries.id, 'o-running'));
  });

  it('returns [] when nothing intersects', async () => {
    expect(
      await span('2027-09-01T00:00:00.000Z', '2027-09-01T01:00:00.000Z')
    ).toEqual([]);
  });
});
