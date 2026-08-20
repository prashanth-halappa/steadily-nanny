/**
 * @module domains/today/components/InviteWaitingCard
 *
 * "You sent a code and nobody has used it yet."
 *
 * WHY: a parent finished onboarding — named her family, added her children,
 * priced a job, minted a code — and landed on a Today tab that said "Nothing
 * scheduled today" and "No shifts in the next two weeks". Technically true,
 * and the wrong subject: her question was about a person, not a calendar. She
 * could not tell whether any of it had saved, so she put the phone down.
 *
 * FEED, NOT THE PINNED SLOT. `attentionOwner.ts`'s rule is that a new rung
 * must name the rung it displaces. This one displaces nothing: nothing decays,
 * nobody's pay is wrong, and there is no action only she can take. It also has
 * to get QUIETER over time, which is the opposite of what the slot is for.
 *
 * IT GETS QUIETER, NEVER LOUDER, AND IT NEVER PUSHES. Days 0-2 it is a card
 * with the code on it; from day 3 it is one line. Nagging a parent about a
 * nanny who has not answered is grading her on somebody else's behaviour.
 *
 * THE CODE IS ON THE CARD, not behind a tap. Re-sending it means being in a
 * messaging app with six characters to hand, and a card that makes you
 * navigate to read them has not solved the problem it exists for.
 *
 * "Hide this" HIDES. It must never revoke: a ghost button that silently kills
 * a code she may already have texted to somebody is a hidden destructive
 * consequence. Stopping a code is a confirmed action, on the Invites screen.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Display, H4, Small } from '@/src/components/ui/typography';
import { useHouseholdInvites } from '@/src/hooks/queries/useHouseholdInvites';
import { useCardDismissal } from '@/src/store/todayCardDismissalStore';
import { resolveInviteWaiting } from './InviteWaitingCard.utils';

const INVITES_ROUTE = '/(private)/settings/invites' as Href;

interface InviteWaitingCardProps {
  householdId: string | undefined;
  /** Someone has already joined as a nanny — then there is nothing to wait for. */
  hasActiveNanny: boolean;
  /** Injected so tests don't depend on the wall clock. */
  now?: Date;
}

export function InviteWaitingCard({
  householdId,
  hasActiveNanny,
  now = new Date(),
}: InviteWaitingCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const invitesQuery = useHouseholdInvites(householdId);
  const { isDismissed, dismiss } = useCardDismissal();

  const state = resolveInviteWaiting({
    householdId,
    invites: invitesQuery.data,
    hasActiveNanny,
    isDismissed,
    now,
  });
  if (state.kind === 'hidden') return null;
  const { invite: waiting, dismissKey } = state;

  const onShare = () => {
    Share.share({
      message: t('household:invite.shareMessage', { code: waiting.code }),
    });
  };

  if (state.kind === 'quiet') {
    return (
      <View
        testID="today-invite-waiting-quiet"
        className="flex-row items-center gap-2"
      >
        <Small className="flex-1 text-muted-strong">
          {t('waitingOnNanny.quietLine', { code: waiting.code })}
        </Small>
        <Button size="sm" variant="ghost" onPress={onShare}>
          <Text>{t('waitingOnNanny.shareButton')}</Text>
        </Button>
        <Button size="sm" variant="ghost" onPress={() => dismiss(dismissKey)}>
          <Text>{t('waitingOnNanny.dismissButton')}</Text>
        </Button>
      </View>
    );
  }

  return (
    <Card testID="today-invite-waiting" provisional>
      <CardContent className="gap-3">
        <H4>{t('waitingOnNanny.title')}</H4>
        <Small className="text-muted-foreground">
          {t('waitingOnNanny.body')}
        </Small>
        <Small className="text-muted-foreground">
          {t('waitingOnNanny.promise')}
        </Small>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('waitingOnNanny.codeA11y', {
            code: waiting.code,
          })}
          onPress={() => router.push(INVITES_ROUTE)}
        >
          <Display
            testID="today-invite-waiting-code"
            selectable
            className="text-primary"
            style={{ letterSpacing: 3.2 }}
          >
            {waiting.code}
          </Display>
        </Pressable>
        <Button
          testID="today-invite-waiting-share"
          variant="outline"
          onPress={onShare}
        >
          <Text>{t('waitingOnNanny.shareButton')}</Text>
        </Button>
        <Button
          testID="today-invite-waiting-dismiss"
          variant="ghost"
          onPress={() => dismiss(dismissKey)}
        >
          <Text>{t('waitingOnNanny.dismissButton')}</Text>
        </Button>
      </CardContent>
    </Card>
  );
}
