/**
 * @module domains/timesheet/utils/carerKey
 *
 * The one rule for "are these two payroll rows the same carer?".
 *
 * `carer_id` stops being an identity the moment the carer deletes her
 * account: `033_preserve_payroll_on_carer_deletion.sql` NULLs it and keeps
 * the row so the parent's record survives. Bucketing on the id alone then
 * sums every departed carer under one heading; bucketing on the NOT NULL
 * `carer_display_name` snapshot instead tells them apart only while their
 * names differ.
 *
 * `058_household_member_identity.sql` fills that gap: a `household_members.id`
 * stamped onto the row at INSERT, carrying no foreign key, so it is still
 * there after the membership row is cascade-deleted with the account. Two
 * departed carers called Emma are two memberships and stay two buckets.
 *
 * Used by the parent's week screen (tabs, totals, which timesheet "Approve"
 * acts on, which expenses land on the statement) and by Today's live-status
 * card (whose hours the duration next to a name covers). Both need the SAME
 * answer — a screen that merges two carers the other splits would show a
 * total under a name the parent then approves against a different row.
 *
 * ponytail: rows whose `carer_id` was already NULL before 058 ran have no
 * membership left to backfill from, so they still merge on a shared display
 * name. Forward-only and accepted — telling THOSE apart would need an
 * identity the deleted account no longer has anywhere.
 */

/** Any payroll row that names a carer: entries, timesheets, expenses. */
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
