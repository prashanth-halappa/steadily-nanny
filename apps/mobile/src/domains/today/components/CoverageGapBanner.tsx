/**
 * @module domains/today/components/CoverageGapBanner
 *
 * Banner when the day-thread has coverage_gap events (Wave D / 1g). An
 * unmet obligation on today — T1/attention (Wave 2-E): opaque
 * `surfaceAttention` ground via `Card tone="attention"`, not the old
 * translucent 15%-alpha warning tint (a shadow over a translucent ground is
 * GOLDEN-FIXES #19; the tint was right, the execution wasn't).
 *
 * `demoted` (default `false`, same contract as `NeedsAttentionCard`): a
 * third independent `tone="attention"` trigger on Today needs an escape
 * hatch too — `TodayScreen` sets it per `utils/attentionOwner`'s ranking
 * whenever something more urgent owns the screen's one T1 slot.
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useTranslation } from 'react-i18next';
import { Card } from '@/src/components/ui/card';
import { Body } from '@/src/components/ui/typography';
import { formatInstantInZone } from '@/src/lib/displayTime';
import { useTodayCoverageGaps } from '../hooks/useTodayCoverageGaps';

interface CoverageGapBannerProps {
  householdId: string;
  timeZone: string;
  demoted?: boolean;
}

function formatGapTime(iso: unknown, timeZone: string): string {
  if (typeof iso !== 'string') return '';
  return formatInstantInZone(iso, timeZone);
}

function gapDescription(
  event: ShiftEvent,
  timeZone: string,
  t: (key: string, options?: Record<string, string>) => string
): string {
  const payload = event.payload;
  const start = formatGapTime(payload.starts_at, timeZone);
  const end = formatGapTime(payload.ends_at, timeZone);
  if (start && end) {
    return t('coverageGap.description', { start, end });
  }
  return t('coverageGap.descriptionFallback');
}

export function CoverageGapBanner({
  householdId,
  timeZone,
  demoted = false,
}: CoverageGapBannerProps) {
  const { t } = useTranslation('today');
  const { gaps } = useTodayCoverageGaps(householdId, timeZone);

  if (gaps.length === 0) return null;

  return (
    <Card
      testID="coverage-gap-banner"
      tone={demoted ? 'default' : 'attention'}
      className="gap-1 p-5.5"
    >
      {/* Rule B: sentence text on `surfaceAttention` stays `foreground` —
          the default typography colour. */}
      <Body weight="medium">{t('coverageGap.title')}</Body>
      {gaps.map(gap => (
        <Body
          key={gap.id}
          testID={`coverage-gap-item-${gap.id}`}
          className="text-sm text-muted-foreground"
        >
          {gapDescription(gap, timeZone, t)}
        </Body>
      ))}
    </Card>
  );
}
