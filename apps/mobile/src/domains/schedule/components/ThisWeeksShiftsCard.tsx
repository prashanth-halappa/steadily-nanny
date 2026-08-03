/**
 * @module domains/schedule/components/ThisWeeksShiftsCard
 *
 * A small, always-visible entry point (both roles) to `/schedule/shifts`.
 * Meant to be mounted on the Today screen (by whichever agent owns
 * `TodayScreen.tsx`). The parent already has a path there via the pending
 * schedule screen's "view shifts" action, but the nanny previously had NO
 * route to it at all — this fills that gap for both roles with one small,
 * unconditional shortcut, rather than gating it to a single role.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';

export function ThisWeeksShiftsCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  return (
    <Card testID="today-shifts-card" className="gap-2 p-5.5">
      <Button
        testID="today-shifts-cta"
        variant="outline"
        onPress={() => router.push('/(private)/schedule/shifts' as Href)}
      >
        <Text>{t('todayCard.shiftsCta')}</Text>
      </Button>
    </Card>
  );
}
