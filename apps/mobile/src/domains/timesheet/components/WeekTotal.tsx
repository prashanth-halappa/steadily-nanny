/**
 * @module domains/timesheet/components/WeekTotal
 * The week's total hours plus a plainly-stated overtime delta, e.g.
 * "9h 14m, +14 min" against what was scheduled — and, when the caller
 * supplies `onPreviousWeek`/`onNextWeek` (D15), the previous/next week
 * navigation controls flanking the week-range label. Nav is optional so
 * existing callers that don't wire it up keep behaving exactly as before.
 *
 * Parent CX: optional carer name + timesheet StatusPill sit above the
 * total so approval state is above the fold; pay-boundary copy states
 * that money settles outside the app.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card, CardContent } from '@/src/components/ui/card';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { WeekNavHeader } from '@/src/components/ui/week-nav-header';
import type { TimesheetStatus } from '../types';

interface WeekTotalProps {
  totalLabel: string;
  overtimeLabel: string | null;
  weekRangeLabel: string;
  testID?: string;
  /** Omit to render without navigation (backwards compatible). */
  onPreviousWeek?: () => void;
  onNextWeek?: () => void;
  /** Never let navigation reach a week later than the current one (Hours). */
  isNextDisabled?: boolean;
  /** Never let navigation page back past the app's bounded history window. */
  isPreviousDisabled?: boolean;
  /** Whose hours these are — Small muted line under the week nav. */
  carerName?: string | null;
  /** Timesheet approval state — StatusPill under the week nav. */
  timesheetStatus?: TimesheetStatus | null;
  /** When true, show the "hours only — pay outside" boundary line. */
  showPayBoundary?: boolean;
}

function timesheetPillVariant(
  status: TimesheetStatus | null | undefined
): 'pending' | 'confirmed' {
  if (status === 'approved') return 'confirmed';
  return 'pending';
}

function timesheetPillLabel(
  status: TimesheetStatus | null | undefined,
  t: (key: string) => string
): string {
  if (status === 'approved') return t('statusApproved');
  if (status === 'submitted') return t('statusSubmitted');
  if (status === 'queried') return t('statusQueried');
  return t('statusNotSubmitted');
}

export function WeekTotal({
  totalLabel,
  overtimeLabel,
  weekRangeLabel,
  testID,
  onPreviousWeek,
  onNextWeek,
  isNextDisabled = false,
  isPreviousDisabled = false,
  carerName,
  timesheetStatus,
  showPayBoundary = false,
}: WeekTotalProps) {
  const { t } = useTranslation('hours');
  const hasNav = !!onPreviousWeek && !!onNextWeek;

  return (
    <Card testID={testID} className="mb-4">
      <CardContent className="gap-1">
        {hasNav ? (
          <WeekNavHeader
            label={weekRangeLabel}
            onPreviousWeek={onPreviousWeek}
            onNextWeek={onNextWeek}
            previousAccessibilityLabel={t('previousWeek')}
            nextAccessibilityLabel={t('nextWeek')}
            isPreviousDisabled={isPreviousDisabled}
            isNextDisabled={isNextDisabled}
          />
        ) : (
          <Small className="text-muted-foreground" tabular>
            {weekRangeLabel}
          </Small>
        )}
        {carerName || timesheetStatus !== undefined ? (
          <View className="mt-1 gap-1">
            {carerName ? (
              <Small
                testID="hours-carer-name"
                className="text-muted-foreground"
              >
                {carerName}
              </Small>
            ) : null}
            {timesheetStatus !== undefined ? (
              <StatusPill
                testID="hours-timesheet-status"
                variant={timesheetPillVariant(timesheetStatus)}
                label={timesheetPillLabel(timesheetStatus, t)}
              />
            ) : null}
          </View>
        ) : null}
        <View className="flex-row items-baseline gap-2">
          <H1 testID="hours-total" tabular>
            {totalLabel}
          </H1>
          {overtimeLabel ? (
            <Body className="text-muted-foreground" tabular>
              {overtimeLabel}
            </Body>
          ) : null}
        </View>
        {totalLabel === '0m' ? (
          <Small testID="hours-empty-week" className="text-muted-foreground">
            {t('emptyWeek')}
          </Small>
        ) : null}
        {showPayBoundary ? (
          <Small testID="hours-pay-boundary" className="text-muted-foreground">
            {t('payBoundary')}
          </Small>
        ) : null}
      </CardContent>
    </Card>
  );
}
