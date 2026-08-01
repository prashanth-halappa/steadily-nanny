/**
 * @module app/(private)/schedule/build
 *
 * Parent flow: build a "usual week" and send it to a carer. See
 * `src/domains/schedule/components/ScheduleBuildScreen` for the real
 * implementation.
 */
import { ScheduleBuildScreen } from '@/src/domains/schedule';

export default function ScheduleBuildRoute() {
  return <ScheduleBuildScreen />;
}
