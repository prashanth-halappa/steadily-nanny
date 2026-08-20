/**
 * @module domains/household/components/CarerProfileScreen
 *
 * Direction §5 — one person screen for a household's carer, reached from a
 * pressable row in `ManageHouseholdScreen`'s member list. Replaces four
 * scattered Settings rows (pay, availability, time off, contact) that made a
 * parent assemble one person out of four places — and, for availability,
 * silently showed the WRONG one when a household had two carers
 * (`carer-availability.tsx`'s bare `find()`).
 *
 * This screen is the fix for that bug: it always knows exactly which carer
 * is on screen (`carerId` from the route), and it is the only entry point
 * that now threads that id into `/settings/carer-availability`.
 *
 * PRIVACY: availability is NOT rendered inline here — this screen navigates
 * into the existing `carer-availability` route, which already enforces
 * "Not available, no reason" (009's `status='active'` positive filter, see
 * that screen's own header comment). Reusing it means the privacy rule has
 * exactly one implementation, not a second copy that could drift.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { ErrorState } from '@/src/components/custom/ErrorState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { BackButton } from '@/src/components/ui/back-button';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Text } from '@/src/components/ui/text';
import { Body, H3, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { useRemoveMember } from '@/src/hooks/mutations/useRemoveMember';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { showSuccessToast } from '@/src/lib/toast';
import { formatDateLong } from '@/src/utils/dateFormatting';

function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function ProfileRow({
  testID,
  label,
  onPress,
  showDivider = false,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  showDivider?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={showDivider ? 'border-border border-t px-4 py-3' : 'px-4 py-3'}
    >
      <Body>{label}</Body>
    </Pressable>
  );
}

export function CarerProfileScreen() {
  const { refreshControl } = usePullToRefresh();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const router = useRouter();
  const params = useLocalSearchParams<{ carerId?: string | string[] }>();
  const carerId = normalizeParam(params.carerId);
  const active = useActiveHousehold();
  const members = useHouseholdMembers(active.householdId);
  const removeMember = useRemoveMember(active.householdId ?? '');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const member: HouseholdMember | null =
    (members.data ?? []).find(m => m.user_id === carerId) ?? null;

  if (members.isLoading) {
    return (
      <View testID="carer-profile-screen" className="flex-1 bg-background">
        <View style={{ padding: SCREEN_CONTENT_STYLE.padding }}>
          <BackButton onPress={() => router.back()} label={tCommon('back')} />
        </View>
        <LoadingIndicator />
      </View>
    );
  }

  // False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): a FAILED members
  // read is also an empty `data`, which the `!member` branch below cannot
  // tell apart from a genuine departure — checked first, or a dropped
  // connection would assert "No longer on this household" about a real
  // person who never left.
  if (members.isError) {
    return (
      <View testID="carer-profile-screen" className="flex-1 bg-background">
        <View style={{ padding: SCREEN_CONTENT_STYLE.padding }}>
          <BackButton onPress={() => router.back()} label={tCommon('back')} />
        </View>
        <ErrorState variant="network" onRetry={() => members.refetch()} />
      </View>
    );
  }

  // No longer resolvable: removed from the household (soft
  // `status: 'removed'`, 009_households.sql) or her account deleted. Render
  // a not-found state rather than a full profile titled "Nanny" with a "?"
  // avatar, live nav into Pay/Availability against a nulled carer id, and a
  // "Remove from this household" button whose confirm dialog silently
  // no-ops (`handleRemove`'s `if (!member) return;`).
  if (!member) {
    return (
      <View testID="carer-profile-screen" className="flex-1 bg-background">
        <View style={{ padding: SCREEN_CONTENT_STYLE.padding }}>
          <BackButton onPress={() => router.back()} label={tCommon('back')} />
        </View>
        <ErrorState
          variant="notFound"
          title={t('carerProfile.notFoundTitle')}
          message={t('carerProfile.notFoundMessage')}
          onSecondaryAction={() => router.back()}
          secondaryLabel={tCommon('back')}
        />
      </View>
    );
  }

  const name = resolveCarerName(member, tSettings('role.nanny'));

  const handleRemove = () => {
    setConfirmingRemove(false);
    if (!member) return;
    removeMember.mutate(member.id, {
      onSuccess: () => {
        showSuccessToast(
          t('householdSettings.removeMemberSuccessToast', { name })
        );
        router.back();
      },
    });
  };

  return (
    <ScrollView
      testID="carer-profile-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
      refreshControl={refreshControl}
    >
      <BackButton onPress={() => router.back()} label={tCommon('back')} />

      <View className="mt-4 flex-row items-center gap-3">
        <PersonAvatar
          testID="carer-profile-avatar"
          name={name}
          colour={member?.colour ?? undefined}
          size="lg"
        />
        <View className="flex-1 gap-0.5">
          <H3>{name}</H3>
          {member?.joined_at ? (
            <Small className="text-muted-foreground">
              {t('carerProfile.withYouSince', {
                date: formatDateLong(member.joined_at),
              })}
            </Small>
          ) : null}
        </View>
      </View>

      <View className="mt-4 flex-row gap-2">
        {member?.profile_phone ? (
          <Pressable
            testID="carer-profile-call"
            accessibilityRole="button"
            onPress={() => void Linking.openURL(`tel:${member.profile_phone}`)}
            className={buttonVariants({ variant: 'secondary' })}
          >
            <Text>{t('carerProfile.callButton')}</Text>
          </Pressable>
        ) : null}
        {member?.profile_phone ? (
          <Pressable
            testID="carer-profile-message"
            accessibilityRole="button"
            onPress={() => void Linking.openURL(`sms:${member.profile_phone}`)}
            className={buttonVariants({ variant: 'secondary' })}
          >
            <Text>{t('carerProfile.messageButton')}</Text>
          </Pressable>
        ) : null}
      </View>

      <Card className="mt-6 overflow-hidden p-0">
        <ProfileRow
          testID="carer-profile-pay-row"
          label={t('carerProfile.payRow')}
          onPress={() => router.push(`/settings/pay/${carerId}` as Href)}
        />
        <ProfileRow
          testID="carer-profile-availability-row"
          label={t('carerProfile.availabilityRow')}
          showDivider
          onPress={() =>
            router.push(
              `/settings/carer-availability?carerId=${carerId}` as Href
            )
          }
        />
        <ProfileRow
          testID="carer-profile-time-off-row"
          label={t('carerProfile.timeOffRow')}
          showDivider
          onPress={() => router.push('/settings/household-time-off' as Href)}
        />
      </Card>

      <Button
        testID="carer-profile-remove-button"
        variant="ghost"
        className="mt-6 self-start px-0"
        onPress={() => setConfirmingRemove(true)}
      >
        <Text className="text-error-inline-text">
          {t('carerProfile.removeButton')}
        </Text>
      </Button>

      <AlertDialog
        open={confirmingRemove}
        onOpenChange={open => setConfirmingRemove(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('householdSettings.removeMemberConfirmTitle', { name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('householdSettings.removeMemberConfirmBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel testID="carer-profile-remove-cancel">
              <Text>{t('householdSettings.removeMemberConfirmCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="carer-profile-remove-confirm"
              className={buttonVariants({ variant: 'destructive' })}
              onPress={handleRemove}
            >
              <Text className="text-destructive-foreground">
                {t('householdSettings.removeMemberConfirmConfirm')}
              </Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollView>
  );
}
