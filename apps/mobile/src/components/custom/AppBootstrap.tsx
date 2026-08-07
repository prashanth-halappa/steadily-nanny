/**
 * Headless app-sync component (the "AppSyncSlot"). Runs the generic startup
 * syncs: remote-config status (drives AppGate), notification-tap routing, and
 * device calendar sync on foreground.
 * Add your own product sync components alongside this one in the root layout.
 */
import { useEffect } from 'react';
import { useCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { useAppStatus } from '@/src/hooks/queries/useAppStatus';
import { NOTIFICATION_ROUTE_MAP } from '@/src/lib/notificationRouteMap';
import { useNotificationObserver } from '@/src/lib/pushNotification';
import { useLiveActivitySync } from '@/src/lib/useLiveActivitySync';
import { useWidgetSnapshotSync } from '@/src/lib/useWidgetSnapshotSync';
import { ensureWidgetArt } from '@/src/lib/widgetArt';
// Side-effect imports: each module's `createWidget` registers its layout with
// the native module, and its `registerWidgetTargets` call hands the instance
// to `widgetSnapshot`, which is what `useWidgetSnapshotSync` then writes to.
// Nothing else imports these, so dropping a line here silently kills a widget.
import '@/src/widgets/NannyWeekWidget';
import '@/src/widgets/NextShiftWidget';
import '@/src/widgets/ParentWeekWidget';
import '@/src/widgets/TodaysCoverWidget';

export function AppBootstrap() {
  // Copy the illustrations into the App Group once per launch. Fire and
  // forget: it resolves long before the queries do, and a payload built
  // before it lands simply carries no art, which every layout allows.
  useEffect(() => {
    void ensureWidgetArt();
  }, []);

  useAppStatus();
  useNotificationObserver(NOTIFICATION_ROUTE_MAP);
  useCalendarSync();
  useWidgetSnapshotSync();
  // The "on the clock" Live Activity: cross-device correction and the late
  // shift match. Here rather than on a screen so it follows the clock.
  useLiveActivitySync();

  return null;
}
