/**
 * @module domains/setup/components/InvitesScreen
 *
 * Every code this household has minted, and what became of each one.
 *
 * WHY THIS EXISTS: the generated code used to live ONLY in `useCreateInvite`'s
 * mutation state. A parent who left the invite step — or force-quit, or just
 * scrolled on — could never see that code again, and there was no list
 * endpoint to recover it from. She had already texted it to somebody, so she
 * could not tell whether to wait or to start over.
 *
 * TWO SHAPES, CHOSEN BY THE DATA. A parent hiring one nanny generates exactly
 * one code, and for her a table with a status column, group headings and the
 * word "revoked" reads like staff administration — the precise feeling this
 * product is trying to keep out of hiring somebody to look after your
 * children. So one live code renders as the same card she saw when she made
 * it, and the list only materialises once there is genuinely something to
 * manage. This is not a compromise: for a single row, a list is strictly
 * worse information design than the card.
 *
 * `InviteRow` and `resolveInviteState` come from the draft domain, where they
 * were built for the nanny's "Sent to" list. One invite row, one set of state
 * words, both audiences — a second copy would be the thing that later
 * disagrees about what "expired" means.
 */
import {
  HOUSEHOLD_STATES,
  type HouseholdInvite,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, DayGroup } from '@/src/components/ui/typography';
import { InviteRow } from '@/src/domains/draft';
import { useRevokeInvite } from '@/src/hooks/mutations/useRevokeInvite';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdInvites } from '@/src/hooks/queries/useHouseholdInvites';
import { InviteCodeCard } from './InviteCodeCard';
import { SetupScreenShell } from './SetupScreenShell';

/** Live from the parent's point of view: still worth sending to somebody. */
function isWaiting(invite: HouseholdInvite): boolean {
  return invite.status === 'pending';
}

export function InvitesScreen() {
  const { t } = useTranslation('household');
  const router = useRouter();
  const { household } = useActiveHousehold();
  const householdId = household?.id;

  const invitesQuery = useHouseholdInvites(householdId);
  const revokeInvite = useRevokeInvite(householdId ?? '');

  const invites = useMemo(() => invitesQuery.data ?? [], [invitesQuery.data]);
  const waiting = invites.filter(isWaiting);
  const settled = invites.filter(invite => !isWaiting(invite));

  // The server already repairs a lapsed `pending` to `expired` on read, so
  // "one waiting code and no history" really does mean a parent at the start.
  const isSingleCode = waiting.length === 1 && settled.length === 0;

  // `now` is read once per render rather than per row, so seven rows on one
  // screen cannot disagree about whether a code has just lapsed.
  const now = useMemo(() => new Date(), []);

  const onShare = (invite: HouseholdInvite) => {
    Share.share({ message: t('invite.shareMessage', { code: invite.code }) });
  };

  const body = () => {
    if (invitesQuery.isPending) return <LoadingIndicator />;
    if (invitesQuery.isError) {
      return (
        <ErrorState
          variant="network"
          onRetry={() => {
            invitesQuery.refetch();
          }}
        />
      );
    }
    if (invites.length === 0) {
      return (
        <EmptyState
          variant="inline"
          title={t('invites.emptyTitle')}
          description={t('invites.emptyBody')}
        />
      );
    }

    if (isSingleCode) {
      const only = waiting[0];
      if (!only) return null;
      return (
        <View testID="invites-single" className="gap-4">
          <InviteCodeCard
            invite={only}
            isError={false}
            onRetry={() => invitesQuery.refetch()}
            onRevoke={() => revokeInvite.mutate(only.id)}
            isRevoking={revokeInvite.isPending}
            currency={household?.currency}
          />
          <Button
            testID="invites-share-button"
            variant="outline"
            onPress={() => onShare(only)}
          >
            <Text>{t('invite.shareButton')}</Text>
          </Button>
        </View>
      );
    }

    return (
      <View testID="invites-list" className="gap-6">
        {waiting.length > 0 ? (
          <View className="gap-2">
            <DayGroup>{t('invites.groupWaiting')}</DayGroup>
            {waiting.map(invite => (
              <InviteRow
                key={invite.id}
                invite={invite}
                viewedAt={null}
                now={now}
                onCopyCode={() => onShare(invite)}
                onShareAgain={() => onShare(invite)}
                onRevoke={() => revokeInvite.mutate(invite.id)}
                isRevoking={revokeInvite.isPending}
                isRevokeError={revokeInvite.isError}
                currency={household?.currency}
              />
            ))}
          </View>
        ) : null}
        {settled.length > 0 ? (
          <View className="gap-2">
            <DayGroup>{t('invites.groupSettled')}</DayGroup>
            {settled.map(invite => (
              <InviteRow
                key={invite.id}
                invite={invite}
                viewedAt={null}
                now={now}
                onCopyCode={() => onShare(invite)}
                onShareAgain={() => onShare(invite)}
                onRevoke={() => revokeInvite.mutate(invite.id)}
                isRevoking={revokeInvite.isPending}
                isRevokeError={revokeInvite.isError}
                currency={household?.currency}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <SetupScreenShell
      testID="invites-screen"
      onBack={() => router.back()}
      backLabel={t('common:back')}
      title={t('invites.title')}
      subtitle={t('invites.subtitle')}
      ctaLabel={t('invites.newCodeButton')}
      // A draft nanny's new code is a different act from a parent's: she
      // invites a FAMILY and her terms travel with it, so she gets the draft
      // send screen rather than the parent's role-picker/pay-offer form.
      onCta={() =>
        router.push(
          (household?.state === HOUSEHOLD_STATES.DRAFT
            ? '/(private)/draft/invite'
            : '/(private)/settings/invite') as Href
        )
      }
    >
      <View className="gap-4">
        {body()}
        <Body testID="invites-footnote" className="text-muted-strong">
          {t('invites.footnote')}
        </Body>
      </View>
    </SetupScreenShell>
  );
}
