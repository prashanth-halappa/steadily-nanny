/**
 * @module domains/schedule/components/ThisWeeksShiftsCard
 *
 * Today entry to this week's shifts. Quiet outline CTA — not an elevated
 * card whose only child is a button (Daylight UX #34).
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';

export function ThisWeeksShiftsCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  return (
    <View testID="today-shifts-card">
      <Button
        testID="today-shifts-cta"
        variant="outline"
        onPress={() => router.push('/(private)/schedule/shifts' as Href)}
      >
        <Text>{t('todayCard.shiftsCta')}</Text>
      </Button>
    </View>
  );
}
