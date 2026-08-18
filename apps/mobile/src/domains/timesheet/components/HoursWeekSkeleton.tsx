/**
 * @module domains/timesheet/components/HoursWeekSkeleton
 *
 * The Hours tab while its week is still loading (screens-hours.md §7). The
 * title and the week label paint immediately — both are derived locally from
 * the household timezone and neither waits on a request — and only the
 * figure and the day rows are skeletons. The screen this replaces returned a
 * full-screen `LoadingIndicator` that blanked the whole tab, title included,
 * on every week change.
 *
 * A skeleton must match the rung it will become (docs/design/00-FOUNDATIONS.md): these
 * are L3 white rows with `elevation.row`, the same shape `TimeEntryDayRow`
 * paints a frame later.
 */
import { View } from 'react-native';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import { useElevation } from '~/lib/design-tokens/elevation';
import { HoursHeroBand, type HoursHeroBandProps } from './HoursHeroBand';

const SKELETON_ROWS = [0, 1, 2];

type HoursWeekSkeletonProps = Pick<
  HoursHeroBandProps,
  | 'weekRangeLabel'
  | 'onPreviousWeek'
  | 'onNextWeek'
  | 'isPreviousDisabled'
  | 'isNextDisabled'
  | 'carerName'
> & { testID?: string };

export function HoursWeekSkeleton({
  testID = 'hours-loading',
  ...navProps
}: HoursWeekSkeletonProps) {
  const elevation = useElevation();

  return (
    <View testID={testID}>
      <HoursHeroBand {...navProps} totalLabel={null} />
      {SKELETON_ROWS.map(index => (
        <View
          key={index}
          className="mb-2 justify-center rounded-row bg-card px-4 py-3"
          style={[elevation.row, { minHeight: 56 }]}
        >
          <SkeletonShimmer
            testID={`hours-day-skeleton-${index}`}
            width="55%"
            height={14}
          />
        </View>
      ))}
    </View>
  );
}

export type { HoursWeekSkeletonProps };
