/**
 * @module domains/today/components/FirstClockInMomentCard
 *
 * Once-per-relationship "you're on the clock here for the first time".
 * Composed beside ClockInCard, never inside it.
 */
import { useTranslation } from 'react-i18next';
import { MomentCard } from '@/src/components/ui/moment-card';

interface FirstClockInMomentCardProps {
  family: string;
  momentKey: string | null;
}

export function FirstClockInMomentCard({
  family,
  momentKey,
}: FirstClockInMomentCardProps) {
  const { t } = useTranslation('today');

  return (
    <MomentCard
      testID="today-first-clock-in-moment"
      illustration="todayHere"
      title={t('moments.firstClockIn.title', { family })}
      body={t('moments.firstClockIn.body')}
      momentKey={momentKey}
    />
  );
}
