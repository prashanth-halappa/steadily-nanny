import { useAppStatus } from '@/src/hooks/queries/useAppStatus';
import type { NotificationRouteMap } from '@/src/lib/pushNotification';
import { useNotificationObserver } from '@/src/lib/pushNotification';

// EXTEND-HERE: map a notification payload `type` (or `triggerType`) to an in-app
// route. See resolveNotificationHref for the shape.
const NOTIFICATION_ROUTE_MAP: NotificationRouteMap = {};

/**
 * Headless app-sync component (the "AppSyncSlot"). Runs the generic startup
 * syncs: remote-config status (drives AppGate) and notification-tap routing.
 * Add your own product sync components alongside this one in the root layout.
 */
export function AppBootstrap() {
  useAppStatus();
  useNotificationObserver(NOTIFICATION_ROUTE_MAP);

  return null;
}
