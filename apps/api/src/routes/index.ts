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
import {
  childCommitmentRoutes,
  commitmentRoutes,
  householdCommitmentRoutes,
} from '../domains/child';
import childRoutes from '../domains/child/routes/childRoutes';
import { handoffRoutes, householdHandoffRoutes } from '../domains/handoff';
import householdRoutes from '../domains/household/routes/householdRoutes';
import { meRoutes } from '../domains/me';
import notificationsRoutes from '../domains/notification/routes/notificationsRoutes';
import {
  expenseIdRoutes,
  expenseRoutes,
  householdPaymentRoutes,
  payArrangementRoutes,
  paymentRoutes,
  ptoRoutes,
  reimbursementSettlementRoutes,
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
import termsProposalItemRoutes from '../domains/termsProposal/routes/termsProposalItemRoutes';
import termsProposalRoutes from '../domains/termsProposal/routes/termsProposalRoutes';
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
router.use('/households/:householdId/commitments', householdCommitmentRoutes);
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
// The same ledger read household-wide instead of week-wide, newest first —
// GET only, because the over-payment gate is defined against ONE week's
// frozen gross. The service resolves a read SCOPE: a parent/owner sees every
// carer's rows, a nanny only her own, and a REMOVED nanny keeps hers.
router.use('/households/:householdId/payments', householdPaymentRoutes);
router.use('/timesheets', timesheetRoutes);

// Pay arrangements — effective-dated terms for one carer in one household.
// Carer-nested ONLY: an arrangement is meaningless outside that pair, so there
// is no flat id-scoped router, and no PATCH/DELETE anywhere (the table is
// append-only — a change is a new row). See docs/11-MONEY.md §2.
router.use(
  '/households/:householdId/carers/:carerId/pay-arrangements',
  payArrangementRoutes
);

// Terms proposals (3-O, D-35) — the same carer-nested scope, because a
// proposal concerns exactly one carer and a household with two nannies has
// two independent negotiations (D-21). A proposal is a MESSAGE about money,
// never a record of it: acceptance inserts the real arrangement through the
// router directly above, under the accepting parent's own credentials.
// Append-only, so no PATCH and no DELETE — a counter is a new row.
router.use(
  '/households/:householdId/carers/:carerId/terms-proposals',
  termsProposalRoutes
);
// The ITEM half, id-scoped: the review screen opens from a push carrying only
// `data.proposalId` and must paint without first resolving the pair (§12). The
// row supplies its own household and carer, and the service gates on those —
// no ownership middleware anywhere on it (GOLDEN-FIXES #32, and the read
// circle here is genuinely wider than the accept gate).
router.use('/terms-proposals', termsProposalItemRoutes);

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

// The record that the family paid an approved reimbursement BACK (D-14,
// migration 086). Household-nested only — a settlement is one carer's week in
// one household, so there is no flat id-scoped router, and no PATCH/DELETE
// anywhere: the table is append-only with no correction path. Mounted BEFORE
// the `/households/:householdId` prefix router below, the same
// more-specific-wins ordering as every other household-nested mount.
//
// NOT payments, and not mounted alongside them: they are excluded from gross,
// from payable minutes and from the payment ceiling. See the guard comment at
// the top of `reimbursementSettlementService.ts`.
router.use(
  '/households/:householdId/reimbursement-settlements',
  reimbursementSettlementRoutes
);

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

export default router;
