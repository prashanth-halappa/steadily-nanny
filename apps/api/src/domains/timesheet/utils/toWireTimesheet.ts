/**
 * The one place a `timesheets` ROW becomes a `Timesheet` on the WIRE.
 *
 * Migration 042's four snapshot columns (`gross_minor`, `currency`,
 * `earnings`, `earnings_computed_at`) are storage, and `TimesheetSchema` in
 * `packages/shared-types/src/schemas/timesheet.schema.ts` deliberately does
 * not carry them. What the wire carries instead is the week read's `earnings`
 * field — already parsed through `WeekEarningsSchema` and tagged with the
 * live/frozen/hours-only state the server decided on the client's behalf
 * (`timesheetQueryService.getWeekWithEarnings`, `docs/11-MONEY.md` §3).
 * Shipping the raw columns alongside it would hand a client a frozen figure
 * with none of the legacy/corrupt handling that decision exists for, and let
 * it draw a number under an "Approved" label the server would have refused
 * to draw.
 *
 * That made this a mapper the READ path used and the two mutation paths did
 * not (Phase 2 review, finding 6): `POST /timesheets/:id/approve` returned the
 * row the repository had just frozen, and `/query` returned `update`'s
 * `select *`. Both now route through here, so there is exactly one answer to
 * "what does a timesheet look like on the wire" and a fifth snapshot column
 * would be stripped everywhere by editing one function.
 *
 * A dependency-free leaf next to `workedMinutes.ts` and `weekStart.ts`, for
 * the same reason those are: the command service and the query service both
 * need it, and neither may import the other.
 *
 * @module domains/timesheet/utils/toWireTimesheet
 */
import type { Timesheet } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import type { TimesheetRow } from '../repositories/timesheetRepository';

/** Drop the four snapshot columns on the way out. */
export function toWireTimesheet(row: TimesheetRow): Timesheet {
  const {
    gross_minor: _gross,
    currency: _currency,
    earnings: _earnings,
    earnings_computed_at: _computedAt,
    ...timesheet
  } = row;
  return timesheet;
}
