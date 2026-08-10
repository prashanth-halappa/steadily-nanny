/**
 * Pay domain schemas — re-exported from the shared wire contract.
 *
 * The pay-arrangement wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/payArrangement.schema` — imported by
 * BOTH the API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable, exactly
 * as `domains/timesheet/schemas.ts` does.
 *
 * SERVER-ONLY schemas (URL params, query validation) belong HERE, alongside
 * the re-export — they must NOT go in the shared package, which is kept to
 * wire shapes only.
 *
 * @module domains/pay/schemas
 */
import { z } from 'zod';

export type {
  CreatePayArrangementRequest,
  PayArrangement,
  PayArrangementListResponse,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
export {
  CreatePayArrangementRequestSchema,
  PayArrangementListResponseSchema,
  PayArrangementSchema,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
export type {
  CreatePaymentInput,
  Payment,
  PaymentListResponse,
} from '@steadily-nanny/shared-types/schemas/payment.schema';
export {
  CreatePaymentSchema,
  PaymentListResponseSchema,
  PaymentSchema,
} from '@steadily-nanny/shared-types/schemas/payment.schema';

/**
 * URL param validation for
 * /households/:householdId/carers/:carerId/pay-arrangements (and its
 * `/current` sibling). Both ids are client-supplied, so both are validated as
 * uuids here and re-checked for membership in the service layer — the shape
 * check is not the authorization check (docs/11-MONEY.md §9).
 */
export const HouseholdCarerParamSchema = z.object({
  householdId: z.uuid(),
  carerId: z.uuid(),
});
export type HouseholdCarerParam = z.infer<typeof HouseholdCarerParamSchema>;

/**
 * Query param validation for the PTO reads
 * (.../carers/:carerId/pto/balance and .../pto/ledger) — the PTO year is the
 * calendar year for v1 (owner decision 3), so both routes require the
 * client to name one explicitly rather than defaulting server-side. The
 * wire contract for the PTO domain itself
 * (`PtoLedgerEntrySchema`/`PtoBalanceSchema`/`MarkTimeOffPaidRequestSchema`)
 * lives in `@steadily-nanny/shared-types/schemas/pto.schema` and is imported
 * directly by `ptoRoutes.ts`/`ptoController.ts` — not re-exported here,
 * since nothing else in this file needs it (same "server-only schemas live
 * alongside the re-export" rule as `HouseholdCarerParamSchema` above).
 */
export const PtoYearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type PtoYearQuery = z.infer<typeof PtoYearQuerySchema>;

/**
 * URL param validation for `/timesheets/:timesheetId/payments` (067). The id
 * is client-supplied, so the shape is checked here and its OWNERSHIP is
 * re-checked in both payment services — the shape check is not the
 * authorization check (docs/11-MONEY.md §9), and unlike the pay-arrangement
 * routes there is no ownership middleware in the chain to fall back on: one
 * timesheet id means two different permissions here (a parent may record a
 * payment, the carer may only read one), which the generic single-resource
 * validator cannot express.
 */
export const TimesheetPaymentsParamSchema = z.object({
  timesheetId: z.uuid(),
});
export type TimesheetPaymentsParam = z.infer<
  typeof TimesheetPaymentsParamSchema
>;

/**
 * URL param validation for `/households/:householdId/payments` — the
 * household-wide settlement history. Same rule as above: the shape check is
 * not the authorization check. `paymentQueryService.assertPaymentReader`
 * re-checks membership and decides whether the caller reads the household or
 * only her own rows (docs/11-MONEY.md §9).
 */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});
export type HouseholdIdParam = z.infer<typeof HouseholdIdParamSchema>;
