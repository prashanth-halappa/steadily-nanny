/**
 * @module app/(private)/settings/time-off
 *
 * Route: `/settings/time-off`. Reached from the Settings tab (nanny only).
 * See `src/domains/timeOff/components/TimeOffScreen` for the implementation.
 */
import { TimeOffScreen } from '@/src/domains/timeOff/components/TimeOffScreen';

export default function TimeOffRoute() {
  return <TimeOffScreen />;
}
