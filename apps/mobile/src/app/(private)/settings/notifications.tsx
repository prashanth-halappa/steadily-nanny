/**
 * @module app/(private)/settings/notifications
 * Route: `/settings/notifications`. Quiet hours + per-type push prefs.
 */
import { NotificationPrefsScreen } from '@/src/domains/settings/components/NotificationPrefsScreen';

export default function NotificationPrefsRoute() {
  return <NotificationPrefsScreen />;
}
