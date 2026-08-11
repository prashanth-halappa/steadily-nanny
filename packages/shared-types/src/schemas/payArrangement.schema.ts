/**
 * Pay arrangement wire contract: the hourly rate and every term that
 * travels with it, effective-dated per (household, carer).
 * @module packages/shared-types/src/schemas/payArrangement.schema
 *
 * Backing table: `pay_arrangements` (supabase/migrations/041_pay_arrangements.sql).
 *
 * Money is integer minor units + a sibling ISO-4217 `currency` code, never a
 * float — see `docs/11-MONEY.md` §1. `rate_minor`, `bill_rate_minor`, and
 * `mileage_rate_per_mile_minor` are pence (or the smallest unit of whatever
 * `currency` names); the mobile `formatMoney`/`parseMajorToMinor` util
 * (`apps/mobile/src/lib/money.ts`) is the only place that converts to/from a
 * display string.
 *
 * Append-only: a change is a NEW row with a later `valid_from`; nothing is
 * ever updated or deleted (`docs/11-MONEY.md` §2). There is deliberately no
 * update/patch schema here — the only write surface is `POST`. The
 * effective-arrangement resolution rule (greatest `valid_from <= date`, ties
 * broken by `created_at desc`) lives in exactly one place,
 * `payArrangementRepository.effectiveOn`, not in this schema.
 */

import { z } from 'zod';

/**
 * ISO-4217: exactly three UPPERCASE letters. A bare `.length(3)` accepted
 * `"ab1"`, `"gbp"` and `"   "` — none of them a currency, all of them
 * storable (review finding 4). The code is load-bearing, not decoration:
 * `apps/mobile/src/lib/money.ts`'s `formatMoney` hands it straight to
 * `Intl.NumberFormat`, which throws a RangeError on a malformed code. That
 * function now degrades to inert text rather than crashing the pay screen,
 * but the fix belongs here too — a bad code should never reach a row.
 * `041_pay_arrangements.sql` pins the identical shape as a CHECK constraint,
 * so wire and table agree.
 *
 * Uppercase only, deliberately: nothing in the stack upcases on the way in,
 * so accepting `"gbp"` here would store a code the DB constraint rejects.
 */
const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * The upper bound on any single money amount on the wire: 99_999_999 minor
 * units, £999,999.99. Exported because `expense.schema.ts` caps `amount_minor`
 * against the same ceiling — two literals that must agree are two literals
 * that eventually don't.
 *
 * A `.min(0)` alone is half a bound. Every field below was floored and
 * unbounded above, so a mistyped rate — a pence value pasted as pounds, a
 * keypad repeat — parsed cleanly at the edge and only became visible further
 * down: as an absurd figure on a payslip, or as an integer overflow in a
 * computed week. This is the same "the wire accepts exactly what the rest of
 * the stack can hold, no more" reasoning as `MilesSchema`'s `numeric(6,1)`
 * bound in `expense.schema.ts`, applied to money.
 *
 * The number is not invented here. It is already the ceiling
 * `parseMajorToMinor` refuses to exceed in `apps/mobile/src/lib/money.ts`
 * (`MAX_MINOR`), and migration 063 pins it as a DB CHECK on these columns —
 * entry form, wire, and table now agree on one figure instead of three.
 *
 * Deliberately NOT applied to minutes fields (they are not money) or to
 * server-COMPUTED output amounts such as `EarningsLine`/`WeekEarnings` gross:
 * a legitimately large computed week must never fail response parse on the
 * client. This bounds what a client may SEND, not what the server may report.
 */
export const MAX_MONEY_MINOR = 99_999_999;

/** `numeric(3, 2)` holds three significant digits with two after the point. */
const MAX_OVERTIME_MULTIPLIER = 9.99;

/**
 * The overtime multiplier, bounded to exactly what its column can hold.
 * `041_pay_arrangements.sql:89` declares `numeric(3, 2)` with only a `>= 1`
 * check, so the wire is the last chance to catch either failure:
 *
 *   - Too big. `1e9` was wire-legal and the service passes it straight
 *     through, so Postgres answered with an untyped "numeric field overflow"
 *     — a 500 on a typo, the same shape of bug `MilesSchema`'s bound below
 *     fixed for `numeric(6,1)`.
 *   - Too precise. `numeric(3, 2)` does not reject `1.555`, it ROUNDS it to
 *     `1.56`. A pay multiplier that changes itself between the form and the
 *     table is the silent-lossy-conversion failure `docs/11-MONEY.md` §1
 *     exists to prevent; the client must be told, not corrected.
 *
 * The precision check compares against an epsilon rather than using
 * `z.multipleOf(0.01)`, which has float-precision false negatives on values
 * the column stores perfectly well: `8.88 / 0.01` is `887.9999999999999` in
 * binary floating point, so `multipleOf` rejects a legitimate two-decimal
 * multiplier. Scaling to an integer and comparing to the nearest whole number
 * within a tolerance has no such gap.
 */
const OvertimeMultiplierSchema = z
  .number()
  .min(1)
  .max(MAX_OVERTIME_MULTIPLIER, {
    message: 'overtime_multiplier must be at most 9.99 (numeric(3,2))',
  })
  .refine(m => Math.abs(m * 100 - Math.round(m * 100)) < 1e-9, {
    message:
      'overtime_multiplier must have at most two decimal places (numeric(3,2))',
  });

/** The persisted entity as returned to clients. */
export const PayArrangementSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: a carer who deletes her account leaves this row behind for
  // the household's payroll record — same ON DELETE SET NULL discipline as
  // timesheets/time_entries (033_preserve_payroll_on_carer_deletion.sql).
  carer_id: z.uuid().nullable(),
  // The `household_members.id` this arrangement was agreed under — stamped at
  // insert by 058's trigger, no foreign key, so it outlives the membership.
  // See `timesheet.schema.ts`'s `TimeEntrySchema.household_member_id`: same
  // key, same optional/nullable meaning. Declared here because 058 stamps
  // this table too, and an undeclared field is a stripped one.
  household_member_id: z.uuid().nullable().optional(),
  rate_minor: z.int().min(0).max(MAX_MONEY_MINOR),
  // Dormant until Tier 2 invoicing — stored now, priced later.
  bill_rate_minor: z.int().min(0).max(MAX_MONEY_MINOR).nullable(),
  currency: CurrencyCodeSchema,
  // Null = no overtime for this arrangement.
  overtime_threshold_minutes: z.int().min(1).nullable(),
  overtime_multiplier: OvertimeMultiplierSchema,
  // Null = no guaranteed-hours top-up.
  guaranteed_minutes_per_week: z.int().min(0).nullable(),
  // Null = no PTO entitlement. Read by Phase 3's ledger accrual.
  pto_entitlement_minutes_per_year: z.int().min(0).nullable(),
  // Null = no mileage reimbursement. Read by Phase 4's expense pricing.
  mileage_rate_per_mile_minor: z.int().min(0).max(MAX_MONEY_MINOR).nullable(),
  // A number of hours means "a cancellation within N hours of the shift's
  // start is paid". Null means NO cancellation pay — an explicit agreement,
  // not the absence of one — and always overrides the household-level
  // fallback column when this arrangement is in effect (owner decision 5).
  cancellation_paid_within_hours: z.int().min(1).nullable(),
  // Household-local today or earlier — enforced in the command service, not
  // here; see CreatePayArrangementRequestSchema's comment for why the shape
  // here stays permissive.
  valid_from: z.iso.date(),
  // Household-local INCLUSIVE last day these terms price; null = still live.
  // Set ONLY when a member is removed, so a rejoin must re-confirm terms
  // (migration 065, docs/11-MONEY.md §10). A lifecycle column, not a money
  // field — there is still no update schema and no client write path.
  valid_to: z.iso.date().nullable(),
  // Snapshotted at insert time from the carer's profile — never derived on
  // read, so the name survives the profile being deleted.
  carer_display_name: z.string(),
  note: z.string().nullable(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

/**
 * POST /households/:householdId/carers/:carerId/pay-arrangements body —
 * the client-settable subset. `household_id`/`carer_id` come from the
 * route, `carer_display_name` is derived server-side from the carer's
 * profile at insert time, and `bill_rate_minor` is dormant (Tier 2) so it
 * has no write path yet — none of the three appear here.
 *
 * `valid_from` accepts any ISO date at the schema level: the
 * household-local "today or earlier" rule (owner decision 4) depends on the
 * household's timezone, which this schema has no access to, so that check
 * lives in `payArrangementCommandService.create`, not here.
 */
export const CreatePayArrangementRequestSchema = z.object({
  rate_minor: z.int().min(0).max(MAX_MONEY_MINOR),
  // No wire default (Phase 1, T4): a household has its own currency now
  // (`household.schema.ts`), and inventing 'GBP' here was a guess with no
  // relationship to where the family lives. Omitted currency is resolved
  // server-side from the household row (`payArrangementCommandService.create`)
  // — this stays optional so a shipped client that still sends its own
  // explicit currency is unaffected (additive, non-breaking).
  currency: CurrencyCodeSchema.optional(),
  overtime_threshold_minutes: z.int().min(1).nullable().optional(),
  overtime_multiplier: OvertimeMultiplierSchema.default(1.5),
  guaranteed_minutes_per_week: z.int().min(0).nullable().optional(),
  pto_entitlement_minutes_per_year: z.int().min(0).nullable().optional(),
  mileage_rate_per_mile_minor: z
    .int()
    .min(0)
    .max(MAX_MONEY_MINOR)
    .nullable()
    .optional(),
  cancellation_paid_within_hours: z.int().min(1).nullable().optional(),
  valid_from: z.iso.date(),
  note: z.string().optional(),
});

/** List response envelope — the append-only history for one carer. */
export const PayArrangementListResponseSchema = z.object({
  pay_arrangements: z.array(PayArrangementSchema),
});

export type PayArrangement = z.infer<typeof PayArrangementSchema>;
export type CreatePayArrangementRequest = z.infer<
  typeof CreatePayArrangementRequestSchema
>;
export type PayArrangementListResponse = z.infer<
  typeof PayArrangementListResponseSchema
>;
