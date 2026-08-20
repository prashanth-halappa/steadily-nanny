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
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { SettingsHeaderButton } from '@/src/components/ui/settings-header-button';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import { SplitTrack } from '@/src/components/ui/split-track';
import {
  Body,
  H1,
  MetadataLabel,
  SignatureHeroBold,
  Small,
} from '@/src/components/ui/typography';
import { WeekBars } from '@/src/components/ui/week-bars';
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
  /** Minutes worked per Postgres dow (0=Sunday). Present → paint `WeekBars`. */
  dayMinutes?: number[];
  /** Rostered minutes for the week, or `null` when there is no schedule. */
  scheduledMinutes?: number | null;
  /** Display-only week start (Postgres dow). Forwarded to `WeekBars`. */
  weekStartsOn?: number;
  /** Postgres dow of today, or null when today is outside this week. */
  todayIndex?: number | null;
  /** Role-resolved lead sentence. Omitted while the week is still loading. */
  lead?: string | null;
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
  dayMinutes,
  scheduledMinutes = null,
  weekStartsOn,
  todayIndex = null,
  lead = null,
  testID = 'hours-hero-band',
}: HoursHeroBandProps) {
  const { t } = useTranslation('hours');
  const colors = useThemeColors();
  const isLoaded = totalLabel !== null;
  const isEmptyWeek = totalLabel === '0m';
  const workedMinutes = (dayMinutes ?? []).reduce(
    (sum, minutes) => sum + Math.max(0, minutes),
    0
  );
  const rosteredMinutes =
    typeof scheduledMinutes === 'number' && scheduledMinutes > 0
      ? scheduledMinutes
      : null;

  return (
    <View testID={testID} className="mb-4 gap-3">
      {/* The gear is the only way into Settings from this tab (WP-C) — it
          rides the title line, not a row of its own. */}
      <View className="flex-row items-start justify-between gap-3">
        <H1 testID="hours-title" className="flex-1">
          {t('title')}
        </H1>
        <SettingsHeaderButton />
      </View>
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
      {isLoaded && lead ? (
        <Small testID="hours-lead" className="text-muted-strong">
          {lead}
        </Small>
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
          <Small testID="hours-empty-week" className="mt-0.5 text-muted-strong">
            {t('emptyWeek')}
          </Small>
        ) : null}
      </View>
      {isLoaded && dayMinutes ? (
        <WeekBars
          testID="hours-week-bars"
          dayMinutes={dayMinutes}
          weekStartsOn={weekStartsOn}
          todayIndex={todayIndex}
        />
      ) : null}
      {isLoaded && rosteredMinutes !== null ? (
        <SplitTrack
          testID="hours-split-track"
          segments={[
            { value: workedMinutes, colour: colors.primary },
            { value: rosteredMinutes, colour: colors.muted },
          ]}
        />
      ) : null}
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
