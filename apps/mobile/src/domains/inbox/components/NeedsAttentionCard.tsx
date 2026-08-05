/**
 * @module domains/inbox/components/NeedsAttentionCard
 *
 * Today-screen entry into the pending-work inbox. Renders NOTHING when
 * the count is zero — same invisible-when-idle discipline as
 * PendingScheduleCard.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { Body } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';

export function NeedsAttentionCard() {
  const { t } = useTranslation(['inbox', 'today']);
  const router = useRouter();
  const { items, isLoading } = useInboxItems();

  if (isLoading || items.length === 0) {
    return null;
  }

  return (
    <Pressable
      testID="today-needs-attention-card"
      onPress={() => router.push('/inbox' as Href)}
      accessibilityRole="button"
    >
      <Card className="gap-1 p-5.5">
        <Body weight="semibold">
          {t('today:needsAttention.title', { count: items.length })}
        </Body>
        <Body className="text-muted-foreground">
          {t('today:needsAttention.body')}
        </Body>
      </Card>
    </Pressable>
  );
}
