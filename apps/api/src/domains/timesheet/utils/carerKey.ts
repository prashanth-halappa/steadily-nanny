/**
 * @module domains/timesheet/utils/carerKey
 *
 * The one rule for "are these two payroll rows the same carer?", server side.
 *
 * The SAME rule three other places already state, and the reason this file
 * exists rather than a fourth inline `??` chain:
 *   - SQL: `061_integrity_checks_departed_carers.sql` and `069_time_entry_void.sql`
 *     bucket on `coalesce(carer_id::text, household_member_id::text)`;
 *   - the client: `apps/mobile/src/domains/timesheet/utils/carerKey.ts`;
 *   - and now every API read that aggregates per carer.
 * A surface that merges two carers another splits shows a total under a name
 * the parent then approves — or files with the IRS — against a different row.
 *
 * `carer_id` stops being an identity the moment the carer deletes her account:
 * `033_preserve_payroll_on_carer_deletion.sql` NULLs it and keeps the row so
 * the household's payroll record survives. Bucketing on the id alone then sums
 * every departed carer under one heading. `058_household_member_identity.sql`
 * stamps a `household_members.id` carrying no foreign key, so it is still
 * there after the membership row is cascade-deleted with the account: two
 * departed carers called Emma are two memberships and stay two buckets.
 *
 * ponytail: rows whose `carer_id` was already NULL before 058 ran have no
 * membership left to backfill from, so they still merge on a shared display
 * name. Forward-only and accepted — telling THOSE apart would need an identity
 * the deleted account no longer has anywhere.
 */

/** Any payroll row that names a carer: entries, timesheets, expenses, ledger rows. */
export interface CarerKeyedRow {
  carer_id: string | null;
  carer_display_name: string;
  /** Optional: absent on pre-058 rows, null when inserted with no carer. */
  household_member_id?: string | null;
}

/**
 * A stable bucket key for one carer's rows. Live carers key on their user id
 * (the strongest identity, and the one that matches across households);
 * departed carers fall back to the membership stamp, then to the name.
 */
export function carerKeyOf(row: CarerKeyedRow): string {
  return row.carer_id ?? row.household_member_id ?? row.carer_display_name;
}
