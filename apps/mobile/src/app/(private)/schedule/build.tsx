/**
 * @module app/(private)/schedule/build
 *
 * Parent flow: build a "usual week" and send it to a carer. See
 * `src/domains/schedule/components/ScheduleBuildScreen` for the real
 * implementation. An optional `?patternId=` (set by SchedulePendingScreen's
 * "Continue building" CTA) resumes that existing draft instead of starting
 * a fresh one.
 */
import { useLocalSearchParams } from 'expo-router';
import { ScheduleBuildScreen } from '@/src/domains/schedule';

export default function ScheduleBuildRoute() {
  const { patternId } = useLocalSearchParams<{ patternId?: string }>();
  return <ScheduleBuildScreen patternId={patternId} />;
}
