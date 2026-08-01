/**
 * Versioned API router (`/api/v1`). Mounted behind Supabase auth in app.ts.
 *
 * SETUP: register your domain routers here, one line each.
 *
 * @module routes/index
 */
import { Router } from 'express';
import childRoutes from '../domains/child/routes/childRoutes';
import householdRoutes from '../domains/household/routes/householdRoutes';
import notificationsRoutes from '../domains/notification/routes/notificationsRoutes';
import usersRoutes from './usersRoutes';

const router = Router();

router.use('/users', usersRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/households', householdRoutes);
router.use('/households/:householdId/children', childRoutes);

export default router;
