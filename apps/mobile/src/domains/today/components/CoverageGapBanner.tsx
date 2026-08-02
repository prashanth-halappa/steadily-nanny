/**
 * @module domains/today/components/CoverageGapBanner
 *
 * Simple banner when the day-thread has coverage_gap events (Wave D / 1g).
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { View } from 'react-native';
import { Body } from '@/src/components/ui/typography';
import { useDayThread } from '@/src/hooks/queries/useDayThread';
import { formatInstantInZone } from '@/src/lib/displayTime';
import { localDateInZone } from '@/src/lib/localDate';

interface CoverageGapBannerProps {
  householdId: string;
  timeZone: string;
}

function formatGapTime(iso: unknown, timeZone: string): string {
  if (typeof iso !== 'string') return '';
  return formatInstantInZone(iso, timeZone);
}

function gapDescription(event: ShiftEvent, timeZone: string): string {
  const payload = event.payload;
  const start = formatGapTime(payload.starts_at, timeZone);
  const end = formatGapTime(payload.ends_at, timeZone);
  if (start && end) return `Coverage gap ${start}–${end}`;
  return 'Coverage gap today';
}

export function CoverageGapBanner({
  householdId,
  timeZone,
}: CoverageGapBannerProps) {
  const localDate = localDateInZone(timeZone);
  const dayThread = useDayThread(householdId, localDate);

  const gaps = (dayThread.data ?? []).filter(
    e => e.event_type === 'coverage_gap'
  );

  if (gaps.length === 0) return null;

  return (
    <View testID="coverage-gap-banner" className="rounded-lg bg-warning/15 p-3">
      <Body className="font-sora-medium text-warning">Coverage gaps today</Body>
      {gaps.map(gap => (
        <Body
          key={gap.id}
          testID={`coverage-gap-item-${gap.id}`}
          className="mt-1 text-sm text-muted-foreground"
        >
          {gapDescription(gap, timeZone)}
        </Body>
      ))}
    </View>
  );
}
