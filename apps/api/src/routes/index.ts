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
  householdTimeOffRoutes,
  timeOffRoutes,
} from '../domains/availability';
import { childCommitmentRoutes, commitmentRoutes } from '../domains/child';
import childRoutes from '../domains/child/routes/childRoutes';
import { handoffRoutes, householdHandoffRoutes } from '../domains/handoff';
import { householdApprovalRoutes } from '../domains/household';
import householdRoutes from '../domains/household/routes/householdRoutes';
import notificationsRoutes from '../domains/notification/routes/notificationsRoutes';
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
router.use('/timesheets', timesheetRoutes);

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
