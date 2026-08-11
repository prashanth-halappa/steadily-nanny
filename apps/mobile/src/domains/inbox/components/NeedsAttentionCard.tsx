/**
 * @module domains/inbox/components/NeedsAttentionCard
 *
 * Today screen's T1 "act now" card — the prominence-ladder tier for an
 * unmet obligation on THIS viewer, right now. Renders NOTHING when the
 * inbox is empty — same invisible-when-idle discipline as
 * PendingScheduleCard.
 *
 * Headline, deadline and CTA copy all come from `inboxItemCopy.ts`, the
 * same module `InboxScreen` uses, so Today and the inbox never word the
 * same fact differently.
 *
 * `pending_pattern` items are filtered out before anything else runs:
 * `PendingScheduleCard` already renders on the identical status/carer_id
 * gate (`buildInboxItems.ts:133`) and routes to the identical destination —
 * a pattern can never become this card's headline, and can never inflate
 * its "N more" count either. An earlier version special-cased this only in
 * headline selection, which still let a sole pending pattern render here
 * AND on `PendingScheduleCard` — two stacked cards for one obligation.
 *
 * `demoted` (default `false`) drops the card to default tone — no
 * `surfaceAttention` ground — while keeping its content and CTA.
 * `TodayScreen` is the only place that sees every T1-eligible card at once,
 * so it owns deciding when something else (an overdue clock-out) should win
 * the screen's one T1 slot; this card never checks for that itself.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H3, MetadataLabel } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import {
  ctaForItem,
  deadlineForItem,
  hrefForItem,
  titleForItem,
} from '@/src/domains/inbox/utils/inboxItemCopy';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';

interface NeedsAttentionCardProps {
  /** Renders at default tone (no attention ground) while keeping content
   * and CTA — for when `TodayScreen` has a higher-priority T1 (an overdue
   * clock-out) and needs this card to step back. */
  demoted?: boolean;
}

export function NeedsAttentionCard({
  demoted = false,
}: NeedsAttentionCardProps) {
  const { t } = useTranslation('inbox');
  const router = useRouter();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const { items: allItems, isLoading } = useInboxItems();
  // A pending pattern is already its own T1 card on Today
  // (`PendingScheduleCard`, same status/carer_id gate, same destination) —
  // filtered out here entirely rather than just skipped for the headline,
  // so it can never inflate the "N more" count either.
  const items = allItems.filter(item => item.kind !== 'pending_pattern');

  if (isLoading || items.length === 0) {
    return null;
  }

  const headline = items[0];
  if (!headline) {
    // Unreachable — items.length === 0 already returned above.
    throw new Error('NeedsAttentionCard: unreachable empty items');
  }
  const deadline = deadlineForItem(headline, t, timeZone, Date.now());
  const moreCount = items.length - 1;

  return (
    <Card
      testID="today-needs-attention-card"
      tone={demoted ? 'default' : 'attention'}
      className="gap-3 p-5.5"
    >
      <H3>{titleForItem(headline, t, timeZone)}</H3>
      {deadline ? (
        <MetadataLabel className="text-destructive">{deadline}</MetadataLabel>
      ) : null}
      {moreCount > 0 ? (
        <Body className="text-muted-foreground">
          {t('needsAttentionCard.moreItems', { count: moreCount })}
        </Body>
      ) : null}
      <View className="gap-2">
        <Button
          testID="today-needs-attention-cta"
          className="w-full"
          onPress={() => router.push(hrefForItem(headline))}
        >
          <Text className="text-primary-foreground font-medium">
            {ctaForItem(headline, t)}
          </Text>
        </Button>
        {moreCount > 0 ? (
          <Button
            testID="today-needs-attention-see-all"
            variant="ghost"
            onPress={() => router.push('/inbox' as Href)}
          >
            <Text className="font-medium">
              {t('needsAttentionCard.seeAll', { count: items.length })}
            </Text>
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
