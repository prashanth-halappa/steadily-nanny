/**
 * The nine read-only integrity checks, ported from Postgres'
 * `run_integrity_checks()` (migrations 056/061/108) to D1. See
 * db/MIGRATION-NOTES.md §5.10. Output shape is unchanged: one
 * `{ check_name, entity_id, details }` row per violation.
 *
 * ponytail: pulls the candidate rows and aggregates in JS rather than one big
 * SQL union (D1 has no tstzrange/date_trunc/array_agg). Fine for a daily
 * families-app sweep; push the aggregates into SQL if row counts reach the
 * hundreds of thousands.
 *
 * @module jobs/integrityChecks
 */
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  expenses,
  householdMembers,
  ptoLedger,
  shifts,
  timeEntries,
  timesheets,
} from '../db/schema';

export interface IntegrityViolation {
  check_name: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
}

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/** ISO Monday of a `YYYY-MM-DD` date (Postgres `date_trunc('week')`). */
export function isoWeekStart(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const minId = (ids: string[]) => [...ids].sort()[0] ?? null;

export async function runIntegrityChecks(
  now: Date = new Date()
): Promise<IntegrityViolation[]> {
  const nowMs = now.getTime();
  const out: IntegrityViolation[] = [];

  const [entries, sheets] = await Promise.all([
    db.select().from(timeEntries),
    db.select().from(timesheets),
  ]);

  // entry_minutes CTE
  const measured = entries.flatMap(te => {
    const carerKey = te.carer_id ?? te.household_member_id;
    if (!te.clock_in_at || !te.clock_out_at || !carerKey) return [];
    const worked = Math.max(
      0,
      Math.round(
        (Date.parse(te.clock_out_at) - Date.parse(te.clock_in_at)) / MIN_MS
      ) - te.break_minutes
    );
    const minutes =
      te.kind === 'cancellation_paid'
        ? Math.max(0, te.scheduled_minutes ?? worked)
        : worked;
    return [
      {
        id: te.id,
        household_id: te.household_id,
        carerKey,
        week_start: isoWeekStart(te.local_date),
        minutes,
      },
    ];
  });
  const weekKey = (h: string, c: string, w: string) => `${h}|${c}|${w}`;
  const weeks = new Map<string, { ids: string[]; minutes: number }>();
  for (const m of measured) {
    const k = weekKey(m.household_id, m.carerKey, m.week_start);
    const w = weeks.get(k) ?? { ids: [], minutes: 0 };
    w.ids.push(m.id);
    w.minutes += m.minutes;
    weeks.set(k, w);
  }

  // timesheet_total_mismatch + approved_snapshot_mismatch
  const sheetKeys = new Set<string>();
  for (const ts of sheets) {
    const carerKey = ts.carer_id ?? ts.household_member_id;
    if (carerKey) {
      const k = weekKey(ts.household_id, carerKey, ts.week_start);
      sheetKeys.add(k);
      const derived = weeks.get(k)?.minutes ?? 0;
      if (ts.total_minutes !== derived)
        out.push({
          check_name: 'timesheet_total_mismatch',
          entity_id: ts.id,
          details: {
            household_id: ts.household_id,
            week_start: ts.week_start,
            stored_minutes: ts.total_minutes,
            derived_minutes: derived,
          },
        });
    }
    const earningsStatus = ts.earnings?.status ?? null;
    if (
      ts.status === 'approved' &&
      ((ts.gross_minor !== null && ts.earnings === null) ||
        (earningsStatus === 'ok' && ts.gross_minor === null))
    )
      out.push({
        check_name: 'approved_snapshot_mismatch',
        entity_id: ts.id,
        details: {
          household_id: ts.household_id,
          week_start: ts.week_start,
          has_gross: ts.gross_minor !== null,
          earnings_status: earningsStatus,
        },
      });
  }

  // pto_net_negative
  const pto = await db
    .select({
      household_id: ptoLedger.household_id,
      time_off_id: ptoLedger.time_off_id,
      net: sql<number>`sum(${ptoLedger.minutes})`,
      rows: sql<number>`count(*)`,
    })
    .from(ptoLedger)
    .where(isNotNull(ptoLedger.time_off_id))
    .groupBy(ptoLedger.household_id, ptoLedger.time_off_id)
    .having(sql`sum(${ptoLedger.minutes}) > 0`);
  for (const p of pto)
    out.push({
      check_name: 'pto_net_negative',
      entity_id: p.time_off_id,
      details: {
        household_id: p.household_id,
        net_paid_minutes: -p.net,
        ledger_rows: p.rows,
      },
    });

  // expense_pending_dup
  const pending = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.status, 'pending'), isNotNull(expenses.carer_id)));
  const dupGroups = new Map<string, typeof pending>();
  for (const e of pending) {
    const k = JSON.stringify([
      e.household_id,
      e.carer_id,
      e.local_date,
      e.kind,
      e.description,
      e.currency,
      e.amount_minor ?? -1,
      e.miles ?? -1,
    ]);
    dupGroups.set(k, [...(dupGroups.get(k) ?? []), e]);
  }
  for (const group of dupGroups.values()) {
    const [first] = group;
    if (group.length > 1 && first)
      out.push({
        check_name: 'expense_pending_dup',
        entity_id: minId(group.map(e => e.id)),
        details: {
          household_id: first.household_id,
          local_date: first.local_date,
          kind: first.kind,
          duplicate_count: group.length,
        },
      });
  }

  // cancellation_unsettled
  const cutoff = new Date(nowMs - 2 * HOUR_MS).toISOString();
  const cancelled = await db
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.cancellation_paid, true),
        eq(shifts.status, 'cancelled'),
        isNotNull(shifts.carer_id),
        lt(sql`coalesce(${shifts.cancelled_at}, ${shifts.updated_at})`, cutoff)
      )
    );
  const settled = new Set(
    entries
      .filter(e => e.kind === 'cancellation_paid' && e.shift_id)
      .map(e => e.shift_id)
  );
  for (const s of cancelled)
    if (!settled.has(s.id))
      out.push({
        check_name: 'cancellation_unsettled',
        entity_id: s.id,
        details: {
          household_id: s.household_id,
          carer_id: s.carer_id,
          cancelled_at: s.cancelled_at,
        },
      });

  // entry_overlap (voided rows deliberately NOT excluded; matches 056)
  const byCarer = new Map<string, typeof entries>();
  for (const e of entries)
    if (e.carer_id && e.clock_in_at && e.clock_out_at)
      byCarer.set(e.carer_id, [...(byCarer.get(e.carer_id) ?? []), e]);
  for (const list of byCarer.values()) {
    list.sort((x, y) => (x.id < y.id ? -1 : 1));
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a?.clock_in_at || !a.clock_out_at || !b?.clock_in_at) continue;
        if (!b.clock_out_at) continue;
        const overlaps =
          Date.parse(a.clock_in_at) < Date.parse(b.clock_out_at) &&
          Date.parse(b.clock_in_at) < Date.parse(a.clock_out_at);
        const sameHousehold = a.household_id === b.household_id;
        if (
          overlaps &&
          (sameHousehold ||
            (a.kind !== 'cancellation_paid' && b.kind !== 'cancellation_paid'))
        )
          out.push({
            check_name: 'entry_overlap',
            entity_id: a.id,
            details: {
              other_entry_id: b.id,
              carer_id: a.carer_id,
              rule: sameHousehold ? 'per_household' : 'per_carer',
            },
          });
      }
  }

  // stuck_runner
  const stuckBefore = nowMs - 20 * HOUR_MS;
  for (const te of entries)
    if (
      te.status === 'running' &&
      !te.clock_out_at &&
      te.clock_in_at &&
      Date.parse(te.clock_in_at) < stuckBefore
    )
      out.push({
        check_name: 'stuck_runner',
        entity_id: te.id,
        details: {
          household_id: te.household_id,
          carer_id: te.carer_id,
          clock_in_at: te.clock_in_at,
        },
      });

  // orphan_week
  const orphanHouseholdCarer = new Map<string, { carer_id: string | null }>();
  for (const te of entries)
    orphanHouseholdCarer.set(te.id, { carer_id: te.carer_id });
  for (const [k, w] of weeks) {
    if (sheetKeys.has(k)) continue;
    const [household_id, , week_start] = k.split('|');
    const entityId = minId(w.ids);
    out.push({
      check_name: 'orphan_week',
      entity_id: entityId,
      details: {
        household_id,
        carer_id: entityId
          ? (orphanHouseholdCarer.get(entityId)?.carer_id ?? null)
          : null,
        week_start,
        entry_count: w.ids.length,
        derived_minutes: w.minutes,
      },
    });
  }

  // household_ownerless: active members present but none is owner/parent
  const members = await db
    .select({
      household_id: householdMembers.household_id,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .where(eq(householdMembers.status, 'active'));
  const roles = new Map<string, string[]>();
  for (const m of members)
    roles.set(m.household_id, [...(roles.get(m.household_id) ?? []), m.role]);
  for (const [household_id, rs] of roles)
    if (!rs.some(r => r === 'owner' || r === 'parent'))
      out.push({
        check_name: 'household_ownerless',
        entity_id: household_id,
        details: {
          active_member_count: rs.length,
          roles: [...new Set(rs)].sort(),
        },
      });

  return out;
}
