/**
 * Headless app-sync component (the "AppSyncSlot"). Runs the generic startup
 * syncs: remote-config status (drives AppGate), notification-tap routing, and
 * device calendar sync on foreground.
 * Add your own product sync components alongside this one in the root layout.
 */
import { useCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { useAppStatus } from '@/src/hooks/queries/useAppStatus';
import { NOTIFICATION_ROUTE_MAP } from '@/src/lib/notificationRouteMap';
import { useNotificationObserver } from '@/src/lib/pushNotification';

export function AppBootstrap() {
  useAppStatus();
  useNotificationObserver(NOTIFICATION_ROUTE_MAP);
  useCalendarSync();

  return null;
}
