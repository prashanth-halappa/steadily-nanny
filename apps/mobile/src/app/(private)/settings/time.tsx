/**
 * @module app/(private)/settings/time
 * Route: `/settings/time`. Display timezone + week-start preferences (D29).
 */
import { TimeSettingsScreen } from '@/src/domains/settings/components/TimeSettingsScreen';

export default function TimeSettingsRoute() {
  return <TimeSettingsScreen />;
}
