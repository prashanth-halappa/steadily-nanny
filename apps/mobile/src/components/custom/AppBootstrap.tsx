/**
 * Headless app-sync component (the "AppSyncSlot"). Runs the generic startup
 * syncs: remote-config status (drives AppGate), notification-tap routing, and
 * device calendar sync on foreground.
 * Add your own product sync components alongside this one in the root layout.
 */
import { useEffect } from 'react';

import { useCalendarSync } from '@/src/domains/schedule/hooks/useCalendarSync';
import { useAppStatus } from '@/src/hooks/queries/useAppStatus';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { endIfStillRunning } from '@/src/lib/liveActivity';
import { NOTIFICATION_ROUTE_MAP } from '@/src/lib/notificationRouteMap';
import { useNotificationObserver } from '@/src/lib/pushNotification';
import { useWidgetSnapshotSync } from '@/src/lib/useWidgetSnapshotSync';
// Side-effect imports: each module's `createWidget` registers its layout with
// the native module, and its `registerWidgetTargets` call hands the instance
// to `widgetSnapshot`, which is what `useWidgetSnapshotSync` then writes to.
// Nothing else imports these, so dropping a line here silently kills a widget.
import '@/src/widgets/NannyWeekWidget';
import '@/src/widgets/NextShiftWidget';
import '@/src/widgets/ParentWeekWidget';
import '@/src/widgets/TodaysCoverWidget';

export function AppBootstrap() {
  useAppStatus();
  useNotificationObserver(NOTIFICATION_ROUTE_MAP);
  useCalendarSync();
  useWidgetSnapshotSync();

  // Cross-device correction for the "on the clock" Live Activity. The server
  // says nobody is running, so a lock screen still claiming she is on the
  // clock is lying — she clocked out on another device, or a parent fixed
  // the record. A local clock-out reaches this same state, which is why
  // `endIfStillRunning` defers to the receipt rather than racing it.
  //
  // `isSuccess` is load-bearing: `data` is undefined while the query is in
  // flight, including for a second at app start, and that must not read as
  // "no running entry".
  const running = useRunningTimeEntry();
  const noRunningEntry = running.isSuccess && running.data == null;
  useEffect(() => {
    if (noRunningEntry) void endIfStillRunning();
  }, [noRunningEntry]);

  return null;
}
