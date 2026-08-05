/**
 * @module domains/schedule/components/PendingScheduleCard
 *
 * The carer's entry point to the respond flow. Meant to be mounted on the
 * Today screen (by whichever agent owns `TodayScreen.tsx` — this component
 * is exported from `src/domains/schedule` for exactly that purpose and
 * takes no props).
 *
 * Renders NOTHING when there is no `pending` schedule pattern where the
 * signed-in user is the carer — no empty state, no placeholder. It should
 * be invisible on an ordinary day, only appearing when there's genuinely
 * something to respond to.
 *
 * Two queries are needed: `useSchedulePatterns` to find a pending pattern
 * addressed to this user, then `useSchedulePattern` for that pattern's
 * `days` (list responses don't include nested days — only the detail route
 * does), so the card can show a real day count + hours total rather than
 * just a bare "you have a pattern" notice.
 *
 * Wave B: reads the household from `useActiveHousehold`, not
 * `useIsOnboarded().householdId` — mounted on `TodayScreen`, this card must
 * track whichever household the switcher currently has selected, same as
 * everything else on that screen.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useSchedulePattern } from '@/src/hooks/queries/useSchedulePattern';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { useAuthStore } from '@/src/store/auth';
import { calculateWeekTotalHours } from '../utils';

export function PendingScheduleCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  const userId = useAuthStore(s => s.session?.user?.id);
  const activeHousehold = useActiveHousehold();

  const patterns = useSchedulePatterns(activeHousehold.householdId);
  const pendingPattern =
    (patterns.data ?? []).find(
      p => p.status === 'pending' && p.carer_id === userId
    ) ?? null;

  const detail = useSchedulePattern(pendingPattern?.id);

  // Invisible until we have BOTH a pending pattern addressed to this user
  // AND its day detail — never show a placeholder or a momentary "0 days".
  if (!pendingPattern || detail.isLoading || !detail.data) {
    return null;
  }

  const days = detail.data.days;
  const totalHours = calculateWeekTotalHours(days);

  return (
    <Card testID="today-pending-schedule-card" className="gap-2 p-5.5">
      <Body weight="semibold">{t('todayCard.pendingTitle')}</Body>
      <Body className="text-muted-foreground" tabular>
        {t('todayCard.pendingBody', { count: days.length, hours: totalHours })}
      </Body>
      <Button
        testID="today-pending-schedule-cta"
        onPress={() =>
          router.push(
            `/(private)/schedule/respond/${pendingPattern.id}` as Href
          )
        }
      >
        <Text className="text-primary-foreground font-medium">
          {t('todayCard.pendingCta')}
        </Text>
      </Button>
    </Card>
  );
}
