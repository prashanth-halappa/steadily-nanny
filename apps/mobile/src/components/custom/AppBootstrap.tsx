import { useEffect } from 'react';
import { configureSubscriptions } from '@/src/domains/subscription';
import { useAppStatus } from '@/src/hooks/queries/useAppStatus';
import type { NotificationRouteMap } from '@/src/lib/pushNotification';
import { useNotificationObserver } from '@/src/lib/pushNotification';

// EXTEND-HERE: map a notification payload `type` (or `triggerType`) to an in-app
// route. See resolveNotificationHref for the shape.
const NOTIFICATION_ROUTE_MAP: NotificationRouteMap = {
  // Example (widget kitchen-sink): the "widget ready" push deep-links to the
  // widget detail route. Remove with the rest of the widget example.
  widget_ready: data =>
    typeof data.widgetId === 'string' ? `/widget/${data.widgetId}` : null,
};

/**
 * Headless app-sync component (the "AppSyncSlot"). Runs the generic startup
 * syncs: remote-config status (drives AppGate + betaAllPro), notification-tap
 * routing, and billing-SDK configuration. Add your own product sync components
 * alongside this one in the root layout.
 */
export function AppBootstrap() {
  useAppStatus();
  useNotificationObserver(NOTIFICATION_ROUTE_MAP);

  useEffect(() => {
    void configureSubscriptions();
  }, []);

  return null;
}
