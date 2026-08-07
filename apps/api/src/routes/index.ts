/**
 * Versioned API router (`/api/v1`). Mounted behind Supabase auth in app.ts.
 *
 * SETUP: register your domain routers here, one line each.
 *
 * @module routes/index
 */
import { Router } from 'express';
import {
  availabilityRoutes,
  householdClosureRoutes,
  householdTimeOffRoutes,
  timeOffRoutes,
} from '../domains/availability';
import { childCommitmentRoutes, commitmentRoutes } from '../domains/child';
import childRoutes from '../domains/child/routes/childRoutes';
import { handoffRoutes, householdHandoffRoutes } from '../domains/handoff';
import { householdApprovalRoutes } from '../domains/household';
import householdRoutes from '../domains/household/routes/householdRoutes';
import { meRoutes } from '../domains/me';
import notificationsRoutes from '../domains/notification/routes/notificationsRoutes';
import {
  expenseIdRoutes,
  expenseRoutes,
  payArrangementRoutes,
  paymentRoutes,
  ptoRoutes,
} from '../domains/pay';
import {
  householdSchedulePatternRoutes,
  schedulePatternRoutes,
} from '../domains/schedule';
import {
  householdShiftRoutes,
  shiftChangeRequestRoutes,
  shiftRoutes,
} from '../domains/shift';
import dayThreadRoutes from '../domains/shift/routes/dayThreadRoutes';
import {
  householdTimeEntryRoutes,
  householdTimesheetRoutes,
  timeEntryRoutes,
  timesheetRoutes,
} from '../domains/timesheet';
import usersRoutes from './usersRoutes';

const router = Router();

router.use('/users', usersRoutes);
router.use('/me', meRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/households', householdRoutes);
router.use('/households/:householdId/children', childRoutes);
// Per-child fixed commitments (preschool, school, activities, naps — flow
// 1g). Nested-then-flat split, same shape as schedule patterns/shifts below.
router.use(
  '/households/:householdId/children/:childId/commitments',
  childCommitmentRoutes
);
router.use('/commitments', commitmentRoutes);

// Availability belongs to the PERSON, not a household — a carer states one
// working frame and every family is checked against it. Hence a top-level mount
// rather than a household-nested one.
router.use('/availability', availabilityRoutes);
router.use('/time-off', timeOffRoutes);
router.use('/households/:householdId/time-off', householdTimeOffRoutes);
router.use('/households/:householdId/closures', householdClosureRoutes);

// Schedule patterns are split deliberately: create/list are household-nested
// (you propose a week TO a household), while acting on an existing pattern is
// id-scoped and flat (send / respond / withdraw). Mount the nested router first
// — Express matches in order, and the more specific path must win.
router.use(
  '/households/:householdId/schedule-patterns',
  householdSchedulePatternRoutes
);
router.use('/schedule-patterns', schedulePatternRoutes);

// Materialised shifts. Same nested-then-flat split as schedule patterns: the
// household-nested router also serves `/:shiftId/events`, the day thread.
router.use('/households/:householdId/shifts', householdShiftRoutes);
// Household/date day thread (includes nullable-shift_id events) — D24.
router.use('/households/:householdId/day-thread', dayThreadRoutes);
router.use('/shifts', shiftRoutes);
router.use('/change-requests', shiftChangeRequestRoutes);

// Time tracking. Clock in/out is carer-scoped and flat; the week's entries and
// the timesheet a parent approves are household-scoped.
router.use('/households/:householdId/time-entries', householdTimeEntryRoutes);
router.use('/time-entries', timeEntryRoutes);
router.use('/households/:householdId/timesheets', householdTimesheetRoutes);
// The settlement ledger for an approved week (067). Timesheet-nested and
// mounted BEFORE the flat `/timesheets` router, the same nested-then-flat
// ordering as shifts and schedule patterns — the more specific path must win.
// (A payment belongs to exactly one week, so there is no flat id-scoped
// router, and no PATCH/DELETE anywhere: the table is append-only. See
// docs/11-MONEY.md and domains/pay/routes/paymentRoutes.ts.)
router.use('/timesheets/:timesheetId/payments', paymentRoutes);
router.use('/timesheets', timesheetRoutes);

// Pay arrangements — effective-dated terms for one carer in one household.
// Carer-nested ONLY: an arrangement is meaningless outside that pair, so there
// is no flat id-scoped router, and no PATCH/DELETE anywhere (the table is
// append-only — a change is a new row). See docs/11-MONEY.md §2.
router.use(
  '/households/:householdId/carers/:carerId/pay-arrangements',
  payArrangementRoutes
);

// Expenses and mileage (Phase 4). Nested-then-flat, the same split as shifts
// and time entries: the household scopes listing and creation, then a flat
// id-scoped router for the carer editing/withdrawing her own pending row and
// for a parent reviewing it. Deliberately `authWithValidation` throughout
// rather than `authWithOwnership` — an expense id has two different "may
// write" meanings depending on the route (owning carer vs. parent of the
// household), which the generic ownership cache cannot express, so every
// gate lives in the service. See docs/11-MONEY.md §6, §8.
router.use('/households/:householdId/expenses', expenseRoutes);
router.use('/expenses', expenseIdRoutes);

// Paid time off (Phase 3). A PREFIX mount, unlike its siblings above: balance
// and ledger are carer-nested (`/carers/:carerId/pto/...`) while mark-paid is
// household-only (`/pto/mark-paid`), so one router owns both shapes under the
// household prefix. Safe alongside the other `/households/:householdId/...`
// routers because an Express Router used as middleware calls next() when none
// of its own routes match, so non-PTO paths fall through untouched.
router.use('/households/:householdId', ptoRoutes);

// Daily handoff notes (design flow 1i): chip-based parent<->nanny notes for
// a household's local date, plus the evening recap. Same nested-then-flat
// split as shifts: household-nested list/create/recap, then flat id-scoped
// update.
router.use('/households/:householdId/handoff-notes', householdHandoffRoutes);
router.use('/handoff-notes', handoffRoutes);

// Co-parent approval queue (design flow 1f): list/respond are household-nested
// only — there is no flat/top-level router, since an approval is always read
// or acted on in the context of its household. See
// domains/household/routes/householdApprovalRoutes.ts for why there is no
// POST / here (creation is an internal side effect of another domain's
// command service, never a direct client write).
router.use('/households/:householdId/approvals', householdApprovalRoutes);

export default router;
