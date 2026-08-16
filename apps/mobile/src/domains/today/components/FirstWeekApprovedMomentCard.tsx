/**
 * @module domains/today/components/FirstWeekApprovedMomentCard
 *
 * Once-per-relationship "your first week is approved". Hours and date only
 * — never a money figure (docs/11-MONEY.md).
 */
import { useTranslation } from 'react-i18next';
import { MomentCard } from '@/src/components/ui/moment-card';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import { formatEarningsLongDate } from '@/src/domains/timesheet/utils/earningsFormat';

interface FirstWeekApprovedMomentCardProps {
  householdName: string;
  totalMinutes: number;
  approvedAt: string;
  momentKey: string | null;
}

export function FirstWeekApprovedMomentCard({
  householdName,
  totalMinutes,
  approvedAt,
  momentKey,
}: FirstWeekApprovedMomentCardProps) {
  const { t } = useTranslation('today');
  const dateISO = approvedAt.includes('T')
    ? approvedAt.slice(0, 10)
    : approvedAt;

  return (
    <MomentCard
      testID="today-first-week-approved-moment"
      illustration="todayDone"
      title={t('moments.firstWeekApproved.title')}
      body={t('moments.firstWeekApproved.body', {
        household: householdName,
        hours: formatDuration(totalMinutes),
        date: formatEarningsLongDate(dateISO),
      })}
      momentKey={momentKey}
    />
  );
}
