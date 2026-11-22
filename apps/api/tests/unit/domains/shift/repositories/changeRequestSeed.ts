/**
 * Fixtures for the shift change-request / event repository tests on the D1
 * test database, plus two interleaving hooks that let a test run a competing
 * write at an exact point inside a repository call.
 *
 * @module tests/unit/domains/shift/repositories/changeRequestSeed
 */
import { shiftLocalDate } from '../../../../../src/db/localDate';
import type { TestDb } from '../../../../helpers/testDb';
import { seedHousehold, seedUser } from '../../schedule/repositories/seed';

export const HH = 'hh-1';
export const PARENT = 'parent-1';
export const NANNY = 'nanny-1';
export const TZ = 'Europe/London';

export async function seedBase(t: TestDb): Promise<void> {
  await seedUser(t, PARENT);
  await seedUser(t, NANNY);
  await seedHousehold(t, HH);
}

export async function resetShiftTables(t: TestDb): Promise<void> {
  await t.d1.batch(
    ['shift_events', 'shift_change_requests', 'time_entries', 'shifts'].map(
      table => t.d1.prepare(`DELETE FROM ${table}`)
    )
  );
}

export async function seedShift(
  t: TestDb,
  opts: {
    starts_at: string;
    ends_at: string;
    id?: string;
    status?: string;
    kind?: string;
    sequence?: number;
    carer_id?: string | null;
  }
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  await t.d1
    .prepare(
      `INSERT INTO shifts (id, household_id, carer_id, starts_at, ends_at, timezone, local_date, kind, status, ical_uid, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      HH,
      opts.carer_id === undefined ? NANNY : opts.carer_id,
      opts.starts_at,
      opts.ends_at,
      TZ,
      shiftLocalDate(opts.starts_at, TZ),
      opts.kind ?? 'extra',
      opts.status ?? 'confirmed',
      `uid-${id}`,
      opts.sequence ?? 0
    )
    .run();
  return id;
}

export async function seedRequest(
  t: TestDb,
  shiftId: string,
  opts: {
    id?: string;
    status?: string;
    kind?: string;
    created_at?: string;
    proposed_starts_at?: string | null;
    proposed_ends_at?: string | null;
  } = {}
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  await t.d1
    .prepare(
      `INSERT INTO shift_change_requests (id, shift_id, requested_by, kind, status, message, proposed_starts_at, proposed_ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'requester note', ?, ?, ?)`
    )
    .bind(
      id,
      shiftId,
      NANNY,
      opts.kind ?? 'cancel',
      opts.status ?? 'pending',
      opts.proposed_starts_at ?? null,
      opts.proposed_ends_at ?? null,
      opts.created_at ?? new Date().toISOString()
    )
    .run();
  return id;
}

export async function seedTimeEntry(
  t: TestDb,
  shiftId: string,
  status = 'submitted'
): Promise<void> {
  await t.d1
    .prepare(
      `INSERT INTO time_entries (id, household_id, carer_id, shift_id, status, local_date, timezone, carer_display_name)
       VALUES (?, ?, ?, ?, ?, '2026-06-01', ?, 'Nanny')`
    )
    .bind(crypto.randomUUID(), HH, NANNY, shiftId, status, TZ)
    .run();
}

export interface RequestRow {
  id: string;
  shift_id: string;
  status: string;
  kind: string;
  message: string | null;
  response_message: string | null;
  responded_by: string | null;
  responded_at: string | null;
}

export interface ShiftRowRaw {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  local_date: string;
  sequence: number;
  origin: string;
  is_short_notice: number;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_paid: number;
  cancellation_message: string | null;
}

export interface EventRow {
  id: string;
  household_id: string;
  shift_id: string | null;
  local_date: string;
  actor_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function requestsFor(
  t: TestDb,
  shiftId: string
): Promise<RequestRow[]> {
  const { results } = await t.d1
    .prepare(
      'SELECT * FROM shift_change_requests WHERE shift_id = ? ORDER BY created_at, id'
    )
    .bind(shiftId)
    .all<RequestRow>();
  return results;
}

export async function requestById(
  t: TestDb,
  id: string
): Promise<RequestRow | null> {
  return t.d1
    .prepare('SELECT * FROM shift_change_requests WHERE id = ?')
    .bind(id)
    .first<RequestRow>();
}

export async function shiftById(
  t: TestDb,
  id: string
): Promise<ShiftRowRaw | null> {
  return t.d1
    .prepare('SELECT * FROM shifts WHERE id = ?')
    .bind(id)
    .first<ShiftRowRaw>();
}

export async function eventsFor(
  t: TestDb,
  shiftId: string
): Promise<EventRow[]> {
  const { results } = await t.d1
    .prepare(
      'SELECT * FROM shift_events WHERE shift_id = ? ORDER BY created_at, event_type'
    )
    .bind(shiftId)
    .all<Omit<EventRow, 'payload'> & { payload: string }>();
  return results.map((r: Omit<EventRow, 'payload'> & { payload: string }) => ({
    ...r,
    payload: JSON.parse(r.payload),
  }));
}

/**
 * Run `action` just before the NEXT `db.batch` — i.e. between a repository's
 * reads and its guarded batch. One-shot: the hook removes itself first, so a
 * retry's batch (and any batch `action` itself runs) goes through untouched.
 */
export function beforeNextBatch(t: TestDb, action: () => Promise<void>): void {
  const db = t.db as unknown as { batch: (...a: unknown[]) => unknown };
  const original = db.batch;
  db.batch = async (...a: unknown[]) => {
    db.batch = original;
    await action();
    return original.apply(db, a);
  };
}

/**
 * Run `action` just before the first statement whose SQL matches `pattern`
 * executes (hooked at the D1 client Drizzle holds). One-shot.
 */
export function beforeQuery(
  t: TestDb,
  pattern: RegExp,
  action: () => Promise<void>
): void {
  type Stmt = Record<string, (...a: unknown[]) => unknown>;
  const session = (t.db as unknown as { session: { client: unknown } }).session;
  const client = session.client as { prepare: (q: string) => Stmt };
  const wrapExec = (stmt: Stmt): Stmt =>
    new Proxy(stmt, {
      get(target, prop) {
        const v = target[prop as string];
        if (typeof v !== 'function') return v;
        if (prop === 'bind') {
          return (...p: unknown[]) => wrapExec(v.apply(target, p) as Stmt);
        }
        return async (...p: unknown[]) => {
          session.client = client;
          await action();
          return v.apply(target, p);
        };
      },
    });
  session.client = new Proxy(client, {
    get(target, prop) {
      const v = (target as unknown as Stmt)[prop as string];
      if (prop === 'prepare') {
        return (q: string) => {
          const stmt = target.prepare(q);
          return pattern.test(q) ? wrapExec(stmt) : stmt;
        };
      }
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
