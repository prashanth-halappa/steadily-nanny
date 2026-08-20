/**
 * @module domains/today/components/MembershipEndedCard
 *
 * The family is gone, and this is the app saying so.
 *
 * Before this existed, `resolveSlotOccupant` returned `null` for a past
 * member: Today's pinned slot — the one surface that can never fall under the
 * fold — was EMPTY. A tester deleted a parent account and the nanny was told
 * nothing at all; her clock-in card was still sitting there, and every write
 * she attempted went into a household nobody could ever approve anything in.
 *
 * WHAT THIS CARD MAY AND MAY NOT SAY. It must not promise she will be paid,
 * and it must not say she won't: the app cannot know either, and a lie in
 * either direction is expensive — one sets up a betrayal, the other defames a
 * family who may well pay her next week. What IS ours to state is what the
 * app does with money, so the second line says exactly that
 * (`docs/11-MONEY.md` §11: `payments` records that money moved OUTSIDE the
 * app). The honest next step is a conversation, not a screen.
 *
 * NEVER `tone="live"`. Apricot means a clock is running. When she is mid-shift
 * this card renders BENEATH the running clock — which keeps the slot and keeps
 * its apricot — and drops its own primary action so there is exactly one
 * thing to press: clock out. That is also the one write a removed member
 * keeps, because closing an entry completes a record rather than taking on an
 * obligation.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { CardArt } from '@/src/components/ui/card-art';
import { Text } from '@/src/components/ui/text';
import { Body, H3, Small } from '@/src/components/ui/typography';

const HOURS_HREF = '/(private)/(tabs)/hours' as Href;
const JOIN_HREF = '/settings/join-household' as Href;

interface MembershipEndedCardProps {
  /** Already resolved for display — this component never derives a name. */
  familyName: string;
  /**
   * Her employer's account was deleted, rather than her being removed.
   * Defaults FALSE on purpose: `ended_reason` is null for any membership that
   * ended before migration 110, and unknown must take the weaker claim.
   * "You're no longer with them" is true either way; "they closed their
   * account" is a fact we would be inventing about a family.
   */
  closed?: boolean;
  /** A time entry of hers is still running (`useOverdueClockOut().clockInAt`). */
  onClock?: boolean;
}

export function MembershipEndedCard({
  familyName,
  closed = false,
  onClock = false,
}: MembershipEndedCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();

  // Literal `t()` per branch, never a ternary inside `t(...)` — the second key
  // is invisible to the locale-key guard that way (the ClockInBlockedCard
  // comment says the same thing, and it is the same trap).
  const title = closed
    ? t('membershipEnded.title', { familyName })
    : t('membershipEnded.titleRemoved', { familyName });
  const body = onClock
    ? t('membershipEnded.bodyOnClock')
    : t('membershipEnded.body');

  return (
    <Card
      testID="today-membership-ended-card"
      tone="default"
      className="gap-3 p-5.5"
    >
      <CardArt
        illustration="membershipEnded"
        size="md"
        testID="today-membership-ended-card-art"
      />
      <H3 testID="today-membership-ended-title">{title}</H3>
      <Body
        testID="today-membership-ended-body"
        className="text-muted-foreground"
      >
        {body}
      </Body>
      <Small className="text-muted-strong">
        {t('membershipEnded.money', { familyName })}
      </Small>
      {onClock ? null : (
        <View className="gap-2">
          <Button
            testID="today-membership-ended-hours"
            onPress={() => router.push(HOURS_HREF)}
          >
            <Text>{t('membershipEnded.hoursCta')}</Text>
          </Button>
          <Button
            testID="today-membership-ended-join"
            variant="ghost"
            onPress={() => router.push(JOIN_HREF)}
          >
            <Text>{t('membershipEnded.joinCta')}</Text>
          </Button>
        </View>
      )}
    </Card>
  );
}
