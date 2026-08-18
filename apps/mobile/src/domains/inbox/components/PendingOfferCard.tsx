/**
 * @module domains/inbox/components/PendingOfferCard
 *
 * A7. The parent who WROTE the terms is the only person who can unblock
 * them, and until this card he had no Today signal at all — his one trace was
 * a settings row titled "Proposed terms from {carerName}", which names the
 * wrong author. Under A1 that is a work stoppage the responsible party cannot
 * see.
 *
 * THE TONE RULE, which is the whole point of the card. Two axes escalate it
 * and they NEVER mix:
 *
 *  - CONSEQUENCE — she has a shift today and her hours cannot be recorded —
 *    is the only thing that produces `'blocking'`, and `'blocking'` is the
 *    only variant that may be attention-toned.
 *  - ELAPSED DAYS move the copy (sentToday -> waiting -> stale) and, at day
 *    10, add Withdraw. They never touch the tone.
 *
 * So a stale offer for a nanny with no shift scheduled stays quiet however
 * old it gets. A card that shouts about a contract nobody is waiting on today
 * is precisely what teaches a parent to ignore the one that matters.
 *
 * The rule is enforced TWICE, deliberately. Upstream, `resolveAttentionOwner`
 * only returns `sentOfferBlocking` when the consequence axis fires, so a quiet
 * offer is never the slot's occupant. And here, the card DECLINES the
 * positional tone unless it is blocking — because it renders in the feed on
 * every other day of its life, and the day someone pins it for a reason the
 * ladder does not currently have, age still must not be able to make it
 * shout.
 *
 * PARENT-EDITOR ROLES ONLY. A nanny author's variant is DEFERRED: her side of
 * "I sent terms and nobody has answered" is already `ClockInBlockedCard`'s
 * `youSent` state, and two cards saying that is the collision the pinned slot
 * exists to end.
 *
 * "SEND A REMINDER" (WP-G) is the card's third axis, and it obeys the same
 * rule as everything else here: it never changes the tone, and it is offered
 * only in the middle of the offer's life. Not on the day it was sent —
 * nobody has had an ordinary chance to read it — and never while blocking,
 * because when she is standing in the house unable to record her hours the
 * fix is to move the terms, not to ask again more politely. The server holds
 * the real limit: one reminder every 48 hours, on the round's age and on the
 * last nudge alike, and its refusal renders inline under the button rather
 * than as a toast that vanishes before it can be acted on.
 *
 * STILL DEFERRED for lack of a mechanism rather than a decision: "she tried
 * to clock in" as a second consequence trigger (it needs a day-thread event
 * type that does not exist).
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Text } from '@/src/components/ui/text';
import { Body, Caption, H3, Small } from '@/src/components/ui/typography';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { usePinnedTone } from '@/src/domains/today/components/PinnedSlot';
import {
  isRemindTooSoon,
  useRemindTerms,
} from '@/src/hooks/mutations/useRemindTerms';
import { useWithdrawTerms } from '@/src/hooks/mutations/useWithdrawTerms';
import { localDateInZone } from '@/src/lib/localDate';
import { usePendingOffer } from '../hooks/usePendingOffer';
import { personOf } from '../utils/buildInboxItems';

/** Day 10 — the point the day counter unlocks taking the offer back. */
const WITHDRAW_FROM_DAY = 10;

export function PendingOfferCard({ nowMs = Date.now() }: { nowMs?: number }) {
  const { t } = useTranslation('inbox');
  const tone = usePinnedTone();
  const router = useRouter();
  // The SAME hook `TodayScreen` asks for `isBlocking` — the ladder and this
  // card must never disagree about whether an offer is loud.
  const { offer, state, scheduledMinutesToday, timeZone } =
    usePendingOffer(nowMs);
  const withdrawTerms = useWithdrawTerms(offer?.id ?? '');
  const remindTerms = useRemindTerms(offer?.id ?? '');

  if (!offer || !state) return null;

  const blocking = state.variant === 'blocking';
  const sentOn = formatDisplayDate(
    localDateInZone(timeZone, new Date(offer.proposedAt))
  );

  // Literal `t()` per branch, never a ternary INSIDE `t(...)` — the locale-key
  // guard cannot see a key assembled from an expression.
  const title = blocking
    ? t('pendingOfferCard.titleBlocking', { carer: offer.carerDisplayName })
    : state.variant === 'sentToday'
      ? t('pendingOfferCard.titleSentToday', {
          carer: offer.carerDisplayName,
        })
      : state.variant === 'stale'
        ? t('pendingOfferCard.titleStale', { days: String(state.days) })
        : t('pendingOfferCard.titleWaiting', {
            carer: offer.carerDisplayName,
          });
  const subtitle = blocking
    ? t('pendingOfferCard.subtitleBlocking', { date: sentOn })
    : state.variant === 'sentToday'
      ? state.opened
        ? t('pendingOfferCard.subtitleSentTodayOpened')
        : t('pendingOfferCard.subtitleSentToday')
      : state.opened
        ? t('pendingOfferCard.subtitleOpened', { date: sentOn })
        : t('pendingOfferCard.subtitleNotOpened', { date: sentOn });
  // Fresh and unanswered, he is checking on it; once it has stalled or
  // started costing her hours, the useful verb is "change".
  const changeIt = blocking || state.variant === 'stale';
  // Never on a blocking offer: when she is standing in the house unable to
  // record her hours, the fix is to move the terms, not to drop them.
  const canWithdraw = !blocking && state.days >= WITHDRAW_FROM_DAY;
  // The middle of its life: past the day it went out, short of the day it is
  // standing between her and her hours.
  const canRemind = !blocking && state.variant !== 'sentToday';
  // The mutation IS the session memory — it holds the answer for as long as
  // this card is mounted, so no second copy of the fact has to be kept.
  const remindedAt = remindTerms.data?.reminded_at ?? null;
  const person = personOf(offer);

  return (
    <Card
      testID="today-pending-offer-card"
      // THE TONE RULE, enforced HERE and not only upstream: positional tone
      // is what the slot offers, and a non-blocking offer declines it. The
      // ladder already refuses to pin a quiet offer, but this card outlives
      // that arrangement — it renders in the feed on every other day of its
      // life, and the day someone pins it for a different reason, age must
      // still not be able to make it shout.
      tone={blocking ? tone : 'default'}
      className="gap-3 p-5.5"
    >
      <View className="flex-row items-center gap-3">
        {person ? (
          <PersonAvatar
            testID="today-pending-offer-avatar"
            name={person.name}
            colour={person.colour}
            size="sm"
          />
        ) : null}
        <H3 testID="today-pending-offer-title" className="flex-1">
          {title}
        </H3>
      </View>
      <Body
        testID="today-pending-offer-subtitle"
        className="text-muted-foreground"
      >
        {subtitle}
      </Body>
      {/* The number is what makes it concrete — "6h today" lands where any
          amount of prose about contracts does not. */}
      {blocking ? (
        <Caption
          testID="today-pending-offer-hours"
          className="text-muted-foreground"
        >
          {t('pendingOfferCard.scheduledToday', {
            carer: offer.carerDisplayName,
            hours: formatDuration(scheduledMinutesToday),
          })}
        </Caption>
      ) : null}
      <View className="gap-2">
        <Button
          testID="today-pending-offer-cta"
          className="w-full"
          onPress={() =>
            router.push(`/(private)/pay/proposal/${offer.id}` as Href)
          }
        >
          <Text
            testID="today-pending-offer-cta-label"
            className="text-primary-foreground font-medium"
          >
            {changeIt
              ? t('pendingOfferCard.ctaChange')
              : t('pendingOfferCard.ctaSee')}
          </Text>
        </Button>
        {canRemind && remindedAt ? (
          <Small
            testID="today-pending-offer-reminded"
            className="text-muted-foreground"
          >
            {t('pendingOfferCard.reminded', {
              date: formatDisplayDate(
                localDateInZone(timeZone, new Date(remindedAt))
              ),
            })}
          </Small>
        ) : null}
        {canRemind && !remindedAt ? (
          <Button
            testID="today-pending-offer-remind"
            variant="ghost"
            disabled={remindTerms.isPending}
            onPress={() => {
              // A refusal renders below; the toast path is for failures that
              // mean the nudge never left the device.
              remindTerms.mutateAsync().catch(() => undefined);
            }}
          >
            <Text className="font-medium">{t('pendingOfferCard.remind')}</Text>
          </Button>
        ) : null}
        {canRemind && !remindedAt && isRemindTooSoon(remindTerms.error) ? (
          <Small
            testID="today-pending-offer-remind-too-soon"
            className="text-muted-foreground"
          >
            {t('pendingOfferCard.remindTooSoon')}
          </Small>
        ) : null}
        {canWithdraw ? (
          <Button
            testID="today-pending-offer-withdraw"
            variant="ghost"
            onPress={() => {
              // NOT a delete — the row goes `withdrawn` and stays in the
              // chain, because "he took it back" is part of how they got here.
              withdrawTerms.mutateAsync().catch(() => undefined);
            }}
          >
            <Text className="font-medium">
              {t('pendingOfferCard.withdraw')}
            </Text>
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
