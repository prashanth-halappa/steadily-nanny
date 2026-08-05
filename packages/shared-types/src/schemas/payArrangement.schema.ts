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

/** The persisted entity as returned to clients. */
export const PayArrangementSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Nullable: a carer who deletes her account leaves this row behind for
  // the household's payroll record — same ON DELETE SET NULL discipline as
  // timesheets/time_entries (033_preserve_payroll_on_carer_deletion.sql).
  carer_id: z.uuid().nullable(),
  rate_minor: z.int().min(0),
  // Dormant until Tier 2 invoicing — stored now, priced later.
  bill_rate_minor: z.int().min(0).nullable(),
  currency: CurrencyCodeSchema,
  // Null = no overtime for this arrangement.
  overtime_threshold_minutes: z.int().min(1).nullable(),
  overtime_multiplier: z.number().min(1),
  // Null = no guaranteed-hours top-up.
  guaranteed_minutes_per_week: z.int().min(0).nullable(),
  // Null = no PTO entitlement. Read by Phase 3's ledger accrual.
  pto_entitlement_minutes_per_year: z.int().min(0).nullable(),
  // Null = no mileage reimbursement. Read by Phase 4's expense pricing.
  mileage_rate_per_mile_minor: z.int().min(0).nullable(),
  // A number of hours means "a cancellation within N hours of the shift's
  // start is paid". Null means NO cancellation pay — an explicit agreement,
  // not the absence of one — and always overrides the household-level
  // fallback column when this arrangement is in effect (owner decision 5).
  cancellation_paid_within_hours: z.int().min(1).nullable(),
  // Household-local today or earlier — enforced in the command service, not
  // here; see CreatePayArrangementRequestSchema's comment for why the shape
  // here stays permissive.
  valid_from: z.iso.date(),
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
  rate_minor: z.int().min(0),
  currency: CurrencyCodeSchema.default('GBP'),
  overtime_threshold_minutes: z.int().min(1).nullable().optional(),
  overtime_multiplier: z.number().min(1).default(1.5),
  guaranteed_minutes_per_week: z.int().min(0).nullable().optional(),
  pto_entitlement_minutes_per_year: z.int().min(0).nullable().optional(),
  mileage_rate_per_mile_minor: z.int().min(0).nullable().optional(),
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
