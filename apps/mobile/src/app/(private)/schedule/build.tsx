/**
 * @module app/(private)/schedule/build
 *
 * Parent flow: build a "usual week" and send it to a carer. See
 * `src/domains/schedule/components/ScheduleBuildScreen` for the real
 * implementation. An optional `?patternId=` (set by SchedulePendingScreen's
 * "Continue building" CTA) resumes that existing draft instead of starting
 * a fresh one. An optional `?carerId=` (set by SchedulePatternBanner's
 * per-carer "Set the weekly hours" arms, S7/S8) pins which carer the wizard
 * is for, skipping its own carer-picker step. An optional `?fromPatternId=`
 * (set by SchedulePendingScreen's "Change it" after withdrawing a pending
 * week) prefills the days from that pattern without reusing its id.
 */
import { useLocalSearchParams } from 'expo-router';
import { ScheduleBuildScreen } from '@/src/domains/schedule';

export default function ScheduleBuildRoute() {
  const { patternId, carerId, fromPatternId } = useLocalSearchParams<{
    patternId?: string;
    carerId?: string;
    fromPatternId?: string;
  }>();
  return (
    <ScheduleBuildScreen
      patternId={patternId}
      carerId={carerId}
      fromPatternId={fromPatternId}
    />
  );
}
