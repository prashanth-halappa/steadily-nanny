/**
 * @module domains/today/components/WeekApprovedCard
 *
 * D78 — "your week was approved", every week, not just the first one.
 * `FirstWeekApprovedMomentCard` is a once-per-relationship celebration and
 * is deliberately money-free; this is the plain L3 acknowledgement that
 * follows every later approval, with the figure she actually cares about.
 * Not a `MomentCard`: a weekly fact is not a milestone, and `moments.*` is
 * the only namespace the voice guard lets carry an exclamation mark.
 *
 * The amount is read through `useWeekTimesheet` (the earnings-bearing
 * `getWeek`), NOT from the household timesheet list `TodayScreen` already
 * holds — `toWireTimesheet` strips `gross_minor`/`currency`/`earnings` off
 * that list response, so there is no amount on it. Same select-my-own-row
 * pattern as `NannyWeekLine`.
 *
 * `docs/11-MONEY.md` §3/§4: the gross is always rendered UNDER the
 * "Approved" state label, and when the week is not in the `ok` earnings
 * state — loading, failed, `no_arrangement`, `currency_change`,
 * `hours_only` — the money line is OMITTED. Never a fabricated £0.00, which
 * is the figure that invites a second payment.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Figure28, H3, H4, Small } from '@/src/components/ui/typography';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import { formatEarningsLongDate } from '@/src/domains/timesheet/utils/earningsFormat';
import { useWeekTimesheet } from '@/src/hooks/queries/useWeekTimesheet';
import { formatMoney } from '@/src/lib/money';

interface WeekApprovedCardProps {
  householdId: string;
  /** Household-local `yyyy-mm-dd` first day of the approved week. */
  weekStart: string;
  /** Whose row to select out of the household's week — hers. */
  carerId: string;
  /** Off the already-loaded list row, so hours never depend on the earnings read. */
  totalMinutes: number;
  /** `approved_at` (or the week start when the row predates it). */
  approvedAt: string;
  /** Deep-links the CTA to the same week the push resolver opens. */
  timesheetId: string;
}

export function WeekApprovedCard({
  householdId,
  weekStart,
  carerId,
  totalMinutes,
  approvedAt,
  timesheetId,
}: WeekApprovedCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const week = useWeekTimesheet(householdId, weekStart);

  // No `?? 0` anywhere: a missing/failed/non-`ok` week yields null and the
  // amount simply does not render.
  const mine = week.isError
    ? undefined
    : (week.data ?? []).find(sheet => sheet.carer_id === carerId);
  const earnings = mine?.earnings;
  const amount =
    earnings?.status === 'ok'
      ? formatMoney(earnings.gross_minor, earnings.currency)
      : null;

  const dateISO = approvedAt.includes('T')
    ? approvedAt.slice(0, 10)
    : approvedAt;
  // The same query shape `hoursHref` (lib/notificationRouteMap.ts) builds, so
  // card and push land on the byte-identical destination.
  const href =
    `/(private)/(tabs)/hours?householdId=${householdId}&weekStart=${weekStart}&timesheetId=${timesheetId}` as Href;

  return (
    <Card testID="today-week-approved-card" tone="default">
      <CardContent className="gap-2">
        <H3>
          {t('weekApproved.title', { week: formatEarningsLongDate(weekStart) })}
        </H3>
        <H4 testID="today-week-approved-state">{t('weekApproved.state')}</H4>
        {amount ? (
          <Figure28 testID="today-week-approved-amount" tabular>
            {amount}
          </Figure28>
        ) : null}
        <Small
          testID="today-week-approved-hours"
          className="text-muted-foreground"
        >
          {t('weekApproved.hours', {
            hours: formatDuration(totalMinutes),
            date: formatEarningsLongDate(dateISO),
          })}
        </Small>
        <Button
          testID="today-week-approved-cta"
          variant="ghost"
          onPress={() => router.push(href)}
        >
          <Text className="text-foreground">{t('weekApproved.cta')}</Text>
        </Button>
      </CardContent>
    </Card>
  );
}
