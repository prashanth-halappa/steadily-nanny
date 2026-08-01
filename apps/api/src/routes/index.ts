/**
 * Versioned API router (`/api/v1`). Mounted behind Supabase auth in app.ts.
 *
 * SETUP: register your domain routers here, one line each.
 *
 * @module routes/index
 */
import { Router } from 'express';
import { availabilityRoutes, timeOffRoutes } from '../domains/availability';
import childRoutes from '../domains/child/routes/childRoutes';
import householdRoutes from '../domains/household/routes/householdRoutes';
import notificationsRoutes from '../domains/notification/routes/notificationsRoutes';
import {
  householdSchedulePatternRoutes,
  schedulePatternRoutes,
} from '../domains/schedule';
import usersRoutes from './usersRoutes';

const router = Router();

router.use('/users', usersRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/households', householdRoutes);
router.use('/households/:householdId/children', childRoutes);

// Availability belongs to the PERSON, not a household — a carer states one
// working frame and every family is checked against it. Hence a top-level mount
// rather than a household-nested one.
router.use('/availability', availabilityRoutes);
router.use('/time-off', timeOffRoutes);

// Schedule patterns are split deliberately: create/list are household-nested
// (you propose a week TO a household), while acting on an existing pattern is
// id-scoped and flat (send / respond / withdraw). Mount the nested router first
// — Express matches in order, and the more specific path must win.
router.use(
  '/households/:householdId/schedule-patterns',
  householdSchedulePatternRoutes
);
router.use('/schedule-patterns', schedulePatternRoutes);

export default router;
