/**
 * @module domains/timesheet/components/HoursHeroBand
 *
 * The Hours statement's first block (docs/design/screens-hours.md §2): the
 * screen title, the week nav, and THE FIGURE — on the screen wash, in no
 * card at all. The figure used to be the fourth band inside `WeekTotal`,
 * where the pay-boundary explainer beneath it had the same visual claim; it
 * is the answer to the question the tab exists for and it does not need a
 * container.
 *
 * `totalLabel === null` means "the hours are still loading" and renders a
 * skeleton bar in the figure's slot — never a fabricated `0m`, and never a
 * full-screen spinner that blanks the title and the week label too. The week
 * label is derived locally from the household timezone, so it paints on the
 * first frame regardless.
 *
 * Rendered inside each week view's `ListHeaderComponent` (not as a fixed
 * header above the list) so the brand wash flows behind it.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import {
  Body,
  H1,
  MetadataLabel,
  SignatureHeroBold,
  Small,
} from '@/src/components/ui/typography';
import { WeekNavHeader } from '@/src/components/ui/week-nav-header';

interface HoursHeroBandProps {
  weekRangeLabel: string;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  isPreviousDisabled?: boolean;
  isNextDisabled?: boolean;
  /** Pre-formatted week total, or `null` while the hours are still loading. */
  totalLabel: string | null;
  /** "14m over scheduled" — omitted when there is nothing to say. */
  overtimeLabel?: string | null;
  /** Parent view only: whose hours these are, above the figure. */
  carerName?: string | null;
  /** Removed from this household — the screen SAYS her record stays rather
   * than just showing no buttons (screens-hours.md §6). */
  isPastMember?: boolean;
  testID?: string;
}

export function HoursHeroBand({
  weekRangeLabel,
  onPreviousWeek,
  onNextWeek,
  isPreviousDisabled = false,
  isNextDisabled = false,
  totalLabel,
  overtimeLabel = null,
  carerName = null,
  isPastMember = false,
  testID = 'hours-hero-band',
}: HoursHeroBandProps) {
  const { t } = useTranslation('hours');
  const isEmptyWeek = totalLabel === '0m';

  return (
    <View testID={testID} className="mb-4 gap-3">
      <H1 testID="hours-title">{t('title')}</H1>
      <WeekNavHeader
        label={weekRangeLabel}
        onPreviousWeek={onPreviousWeek}
        onNextWeek={onNextWeek}
        previousAccessibilityLabel={t('previousWeek')}
        nextAccessibilityLabel={t('nextWeek')}
        isPreviousDisabled={isPreviousDisabled}
        isNextDisabled={isNextDisabled}
      />
      {carerName ? (
        <Body testID="hours-carer-name" weight="semibold" numberOfLines={1}>
          {carerName}
        </Body>
      ) : null}
      <View>
        {totalLabel === null ? (
          <SkeletonShimmer
            testID="hours-total-skeleton"
            width={140}
            height={40}
            borderRadius={8}
          />
        ) : (
          <SignatureHeroBold
            testID="hours-total"
            tabular
            numberOfLines={1}
            className={isEmptyWeek ? 'text-muted-foreground' : undefined}
          >
            {totalLabel}
          </SignatureHeroBold>
        )}
        {overtimeLabel ? (
          <MetadataLabel
            testID="hours-overtime"
            className="mt-0.5 text-muted-strong"
            tabular
          >
            {overtimeLabel}
          </MetadataLabel>
        ) : null}
        {isEmptyWeek ? (
          <Small
            testID="hours-empty-week"
            className="mt-0.5 text-muted-foreground"
          >
            {t('emptyWeek')}
          </Small>
        ) : null}
      </View>
      {isPastMember ? (
        <MetadataLabel
          testID="hours-past-member-note"
          className="text-muted-strong"
        >
          {t('pastMemberNote')}
        </MetadataLabel>
      ) : null}
    </View>
  );
}

export type { HoursHeroBandProps };
