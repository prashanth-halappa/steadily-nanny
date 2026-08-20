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
 * `PendingScheduleCard` already renders one card PER pending pattern, across
 * EVERY household she belongs to (Pattern A's inverse fix) — not just the
 * active one — so a pattern can never become this card's headline, and can
 * never inflate its "N more" count either, regardless of which household it
 * belongs to. An earlier version special-cased this only in headline
 * selection, which still let a sole pending pattern render here AND on
 * `PendingScheduleCard` — two stacked cards for one obligation.
 *
 * TONE IS POSITIONAL. `usePinnedTone()` returns `'attention'` only when this
 * card is the single child of Today's `PinnedSlot`, and `'default'`
 * everywhere else — the card keeps its content and CTA in the feed, it just
 * stops shouting. It never decides that for itself, and there is no `demoted`
 * prop to pass: `resolveSlotOccupant` picks the occupant, the slot supplies
 * the tone.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Text } from '@/src/components/ui/text';
import { Body, H3, MetadataLabel } from '@/src/components/ui/typography';
import { useInboxItems } from '@/src/domains/inbox/hooks/useInboxItems';
import {
  householdIdOf,
  personOf,
} from '@/src/domains/inbox/utils/buildInboxItems';
import {
  ctaForItem,
  deadlineForItem,
  hrefForItem,
  titleForItem,
} from '@/src/domains/inbox/utils/inboxItemCopy';
import { usePinnedTone } from '@/src/domains/today/components/PinnedSlot';
import { useHouseholdLookup } from '@/src/hooks/queries/useHouseholdById';

export function NeedsAttentionCard() {
  const { t } = useTranslation('inbox');
  const tone = usePinnedTone();
  const router = useRouter();
  const { timeZoneFor } = useHouseholdLookup();
  const { items: allItems, isLoading } = useInboxItems();
  // A pending pattern is already its own T1 card on Today —
  // `PendingScheduleCard` covers one per household she belongs to, not only
  // the active one — filtered out here entirely rather than just skipped
  // for the headline, so it can never inflate the "N more" count either.
  // A terms proposal is the same story on the other side of the ladder
  // (§7.1/B3): it has its own T1 card and its own rung in
  // `resolveAttentionOwner`, so it must not headline here or inflate the
  // count either.
  // A7's `terms_proposal_sent` is filtered on exactly the same grounds as
  // `terms_proposal`: it has its own card (`PendingOfferCard`) and its own
  // rung, and it is the ONE row here that waits on somebody else — headlining
  // it would put a card the viewer cannot resolve at the top of a list of
  // things he can.
  const items = allItems.filter(
    item =>
      item.kind !== 'pending_pattern' &&
      item.kind !== 'terms_proposal' &&
      item.kind !== 'terms_proposal_sent'
  );

  if (isLoading || items.length === 0) {
    return null;
  }

  const headline = items[0];
  if (!headline) {
    // Unreachable — items.length === 0 already returned above.
    throw new Error('NeedsAttentionCard: unreachable empty items');
  }
  // Pattern A: the headline is drawn from EVERY household's inbox, so its
  // date/deadline must read in ITS OWN household's zone, never whichever one
  // the switcher currently has active.
  const timeZone = timeZoneFor(householdIdOf(headline));
  const deadline = deadlineForItem(headline, t, timeZone, Date.now());
  const moreCount = items.length - 1;
  const person = personOf(headline);

  return (
    <Card
      testID="today-needs-attention-card"
      tone={tone}
      className="gap-3 p-5.5"
    >
      <View className="flex-row items-center gap-3">
        {person ? (
          <PersonAvatar
            testID="today-needs-attention-avatar"
            name={person.name}
            colour={person.colour}
            size="sm"
          />
        ) : null}
        <H3 className="flex-1">{titleForItem(headline, t, timeZone)}</H3>
      </View>
      {deadline ? (
        <MetadataLabel className="text-error-inline-text">
          {deadline}
        </MetadataLabel>
      ) : null}
      {moreCount > 0 ? (
        <Body
          className={
            tone === 'attention' ? 'text-muted-strong' : 'text-muted-foreground'
          }
        >
          {t('needsAttentionCard.moreItems', { count: moreCount })}
        </Body>
      ) : null}
      <View className="gap-2">
        <Button
          testID="today-needs-attention-cta"
          variant={tone === 'attention' ? 'default' : 'ghost'}
          size={tone === 'attention' ? 'lg' : 'default'}
          className={tone === 'attention' ? 'w-full' : 'self-start px-0'}
          onPress={() => router.push(hrefForItem(headline))}
        >
          <Text className="font-medium">{ctaForItem(headline, t)}</Text>
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
