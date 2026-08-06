/**
 * @module domains/timesheet/components/WeekTotal
 * The week's total hours plus a plainly-stated "vs scheduled" delta, e.g.
 * "9h 14m, 14m over scheduled" against what was scheduled — and, when the
 * caller supplies `onPreviousWeek`/`onNextWeek` (D15), the previous/next
 * week navigation controls flanking the week-range label. Nav is optional so
 * existing callers that don't wire it up keep behaving exactly as before.
 *
 * Parent CX: optional carer name + timesheet StatusPill sit above the
 * total so approval state is above the fold.
 *
 * Money (TIER0-CX-SPEC.md §4.1): `WeekEarningsLine` renders immediately
 * below `hours-total` and above `payBoundary` — same card, `CardContent`'s
 * existing `gap-1` plus the line's own `mt-1`, no extra card, no divider
 * (Daylight separates by light). `earnings === undefined`/`null` renders
 * nothing (no data yet, or no timesheet row exists for this week) —
 * `WeekEarningsLine`'s own header comment has the full state table.
 *
 * Reopen (walkthrough fix, 2026-08): the "undo approve" affordance lives
 * here, right after the gross figure, rather than in `ParentWeekView`'s
 * FlashList footer — that buried it below every day row and the
 * reimbursements card, invisible on first load for the exact moment a
 * parent doubts an approved total. `variant="destructive"` gives it the
 * same solid, high-weight treatment as the app's other real destructive
 * confirms (`settings-delete-account-confirm`, the shift decline confirm in
 * `ScheduleRespondScreen`) — deliberately heavier than the `ghost` Query
 * button beside it in the footer, which is not destructive. Omit
 * `onReopenPress` to render nothing at all (a helper's `readOnly` view, or
 * `NannyWeekView`, which never reopens).
 *
 * The reopen *reason* caption is also owned here — it is a timesheet-status
 * fact ("this week was un-approved, and here is why"), not an earnings
 * fact. Rendering it inside `WeekEarningsLine`'s `ok` arm silently dropped
 * it on no-arrangement / hours-only / zero-hours / earnings-null weeks.
 * Keep `testID="hours-earnings-line-reopened-note"` stable for Maestro.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import {
  Body,
  Display,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { WeekNavHeader } from '@/src/components/ui/week-nav-header';
import type { TimesheetStatus, WeekEarningsStateResult } from '../types';
import type { EarningsRole } from './WeekEarningsLine';
import { WeekEarningsLine } from './WeekEarningsLine';

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
  /** Timesheet approval state — StatusPill under the week nav (when
   * `showStatusPill` allows it), and the "Estimated"/"Approved" label on
   * `WeekEarningsLine` regardless. */
  timesheetStatus?: TimesheetStatus | null;
  /** Explicit override for the carer-name/StatusPill block's visibility.
   * Defaults to the pre-money-line heuristic (`carerName` present OR
   * `timesheetStatus` supplied at all) so existing callers are unaffected.
   * `NannyWeekView` needs `timesheetStatus` supplied for the money line's
   * label WITHOUT also turning on a StatusPill nobody asked her screen to
   * show — that's what this override is for. */
  showStatusPill?: boolean;
  /** When true, show the "hours only — pay outside" boundary line. */
  showPayBoundary?: boolean;
  /** Total worked minutes this week — the raw number `WeekEarningsLine`
   * needs for the zero-hours omission rule; `totalLabel` is the pre-formatted
   * display string, not enough on its own. */
  totalMinutes?: number;
  /** Omit entirely to render no money line at all (money is opt-in per
   * caller, not every `WeekTotal` render needs it). */
  earnings?: WeekEarningsStateResult | null;
  earningsRole?: EarningsRole;
  /** The timesheet's carer — for the parent no-arrangement nudge's deep link. */
  earningsCarerId?: string | null;
  /** For the departed-carer caption. */
  earningsCarerDisplayName?: string;
  earningsError?: boolean;
  onRetryEarnings?: () => void;
  onPressEarnings?: () => void;
  /** TIER0-CX-SPEC.md §8 "Approved week that reopens" — see `utils/reopenedNotice.ts`. */
  earningsReopened?: boolean;
  /** Wire `reopen_reason` — cold-mount caption; rendered here (not in
   * `WeekEarningsLine`) so every earnings state still surfaces it. */
  earningsReopenReason?: string | null;
  /** Parent-only "undo approve" — renders `hours-reopen-button` in this
   * card, next to the status pill/gross, when `timesheetStatus` is
   * `'approved'`. Omit to render nothing (helper `readOnly` view,
   * `NannyWeekView`, or any non-approved week). */
  onReopenPress?: () => void;
  isReopenPending?: boolean;
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
  showStatusPill,
  showPayBoundary = false,
  totalMinutes = 0,
  earnings,
  earningsRole = 'nanny',
  earningsCarerId = null,
  earningsCarerDisplayName = '',
  earningsError = false,
  onRetryEarnings,
  onPressEarnings,
  earningsReopened = false,
  earningsReopenReason = null,
  onReopenPress,
  isReopenPending = false,
}: WeekTotalProps) {
  const { t } = useTranslation('hours');
  const hasNav = !!onPreviousWeek && !!onNextWeek;
  const shouldShowStatusPillBlock =
    showStatusPill ?? (!!carerName || timesheetStatus !== undefined);
  // Locale-key extractor reads the first string literal inside `t(` as the
  // key — an inline `earningsRole === 'parent'` comparison makes it think
  // 'parent' is a key. Choose the key from a boolean instead.
  const isParentViewer = earningsRole === 'parent';
  const showReopenedNote =
    timesheetStatus !== 'approved' &&
    (!!earningsReopenReason || earningsReopened);

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
        {shouldShowStatusPillBlock ? (
          <View className="mt-1 flex-row items-center justify-between gap-2">
            {carerName ? (
              <Body
                testID="hours-carer-name"
                weight="semibold"
                className="flex-1"
                numberOfLines={1}
              >
                {carerName}
              </Body>
            ) : null}
            {timesheetStatus !== undefined ? (
              <View className="flex-shrink-0">
                <StatusPill
                  testID="hours-timesheet-status"
                  variant={timesheetPillVariant(timesheetStatus)}
                  label={timesheetPillLabel(timesheetStatus, t)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        <View className="mt-2 flex-row items-baseline gap-2">
          <Display testID="hours-total" tabular>
            {totalLabel}
          </Display>
          {overtimeLabel ? (
            <Small className="text-muted-foreground" tabular>
              {overtimeLabel}
            </Small>
          ) : null}
        </View>
        {totalLabel === '0m' ? (
          <Small testID="hours-empty-week" className="text-muted-foreground">
            {t('emptyWeek')}
          </Small>
        ) : null}
        {earnings !== undefined || earningsError ? (
          <WeekEarningsLine
            earnings={earnings ?? null}
            timesheetStatus={timesheetStatus}
            viewerRole={earningsRole}
            carerId={earningsCarerId}
            carerDisplayName={earningsCarerDisplayName}
            carerName={carerName}
            totalMinutes={totalMinutes}
            earningsError={earningsError}
            onRetryEarnings={onRetryEarnings}
            onPress={onPressEarnings}
          />
        ) : null}
        {/* Status-gated, earnings-independent. Prefer the wire reason;
            fall back to the ephemeral same-session `useReopenedNotice`
            caption. Never on an approved week. */}
        {showReopenedNote ? (
          <Small
            testID="hours-earnings-line-reopened-note"
            className="text-muted-foreground"
          >
            {earningsReopenReason
              ? t(
                  isParentViewer
                    ? 'earningsReopenedWithReasonParent'
                    : 'earningsReopenedWithReasonNanny',
                  { reason: earningsReopenReason }
                )
              : t('earningsReopenedNote')}
          </Small>
        ) : null}
        {timesheetStatus === 'approved' && onReopenPress ? (
          <Button
            testID="hours-reopen-button"
            variant="destructive"
            size="sm"
            className="mt-1 self-start"
            disabled={isReopenPending}
            onPress={onReopenPress}
          >
            <Text>{t('reopenWeek')}</Text>
          </Button>
        ) : null}
        {showPayBoundary ? (
          <MetadataLabel
            testID="hours-pay-boundary"
            className="mt-3 text-muted-foreground"
          >
            {t('payBoundary')}
          </MetadataLabel>
        ) : null}
      </CardContent>
    </Card>
  );
}
