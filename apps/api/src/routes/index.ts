/**
 * Versioned API router (`/api/v1`). Mounted behind Supabase auth in app.ts.
 *
 * SETUP: register your domain routers here, one line each.
 *
 * @module routes/index
 */
import { Router } from 'express';
import notificationsRoutes from '../domains/notification/routes/notificationsRoutes';
import subscriptionRoutes from '../domains/subscription/routes/subscriptionRoutes';
import widgetRoutes from '../domains/widget/routes/widgetRoutes';
import usersRoutes from './usersRoutes';

const router = Router();

router.use('/users', usersRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/notifications', notificationsRoutes);
// Example feature domain (kitchen-sink) — remove with the rest of the widget example.
router.use('/widgets', widgetRoutes);

export default router;
