/**
 * @module domains/setup/components/ManageInviteScreen
 *
 * Post-onboarding entry point (Settings → Invite someone): a parent could
 * only ever generate ONE invite code, during first-run setup — there was no
 * way to onboard another household member later. Unlike the wizard's
 * `InviteScreen`, this screen does NOT auto-generate a code on mount:
 * revisiting a settings screen must be idempotent, and auto-firing
 * `useCreateInvite` every time this screen is reached would silently mint
 * an unused invite code per visit. The parent explicitly taps "Generate"
 * instead. Role is chosen via `InviteRolePicker` (nanny / co-parent / helper).
 *
 * Reuses `InviteCodeCard` for the code/retry display so both screens render
 * identical UI once a code exists. `SetupScreenShell`'s CTA goes back to
 * wherever the parent came from (no progress bar, no "next step").
 *
 * P8: also lets a parent see and change the pay OFFER on a nanny invite —
 * before minting (a local draft, same as InviteScreen) and after minting, on
 * the invite this session just created. There is no PATCH for `pay_offer`
 * (`UpdateHouseholdInviteSchema` only allows `status: 'revoked'`), so
 * changing an already-minted offer is a revoke-then-recreate: the invite's
 * CODE changes as a side effect, since a new invite always mints a new one.
 */
import type { HouseholdInviteRole } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HOUSEHOLD_INVITE_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { CreatePayArrangementRequest } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Small } from '@/src/components/ui/typography';
import { PayChangeSheet } from '@/src/domains/pay/components/PayChangeSheet';
import {
  formatDisplayDateWithYear,
  offerRequestToArrangementStub,
} from '@/src/domains/pay/utils/payArrangementForm';
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { InviteRolePicker } from '@/src/domains/setup/components/InviteRolePicker';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useRevokeInvite } from '@/src/hooks/mutations/useRevokeInvite';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { localDateInZone } from '@/src/lib/localDate';
import { formatRate } from '@/src/lib/money';
import { InviteOfferSummary } from './InviteOfferSummary';

export function ManageInviteScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const onboarding = useIsOnboarded();
  const householdId = onboarding.householdId ?? '';

  const createInvite = useCreateInvite(householdId);
  const revokeInvite = useRevokeInvite(householdId);
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedRole, setSelectedRole] = useState<HouseholdInviteRole>(
    HOUSEHOLD_INVITE_ROLES.NANNY
  );

  // P8's offer card — same shape as InviteScreen's pre-mint draft, PLUS
  // (below) the post-mint edit path this screen alone offers.
  const { household } = useActiveHousehold();
  const currency = household?.currency ?? getDeviceCurrency();
  const timezone = household?.timezone ?? 'UTC';
  const todayISO = localDateInZone(timezone);
  const [payOffer, setPayOffer] = useState<CreatePayArrangementRequest | null>(
    null
  );
  const [offerSheetVisible, setOfferSheetVisible] = useState(false);

  const invite = createInvite.data ?? null;
  const code = invite?.code ?? null;
  const isReplacingOffer = revokeInvite.isPending || createInvite.isPending;

  const onGenerate = () => {
    setHasStarted(true);
    createInvite.mutate(
      selectedRole === HOUSEHOLD_INVITE_ROLES.NANNY && payOffer
        ? { role: selectedRole, pay_offer: payOffer }
        : { role: selectedRole }
    );
  };

  const onShare = () => {
    if (!code) return;
    void Share.share({ message: t('invite.shareMessage', { code }) });
  };

  // See InviteScreen: both the mutation state InviteCodeCard reads and the
  // local `hasStarted` flag must clear, or the card is stuck on its loading
  // spinner instead of returning to the role picker.
  const onRevoke = () => {
    if (!invite) return;
    revokeInvite.mutate(invite.id, {
      onSuccess: () => {
        createInvite.reset();
        setHasStarted(false);
      },
    });
  };

  // No PATCH exists for `pay_offer` — revoke the pending invite, then mint a
  // fresh one carrying the new offer. `hasStarted` stays true throughout:
  // this replaces the code InviteCodeCard shows, it doesn't return to the
  // role picker.
  const onSubmitOffer = (request: CreatePayArrangementRequest) => {
    if (hasStarted && invite) {
      revokeInvite.mutate(invite.id, {
        onSuccess: () => {
          createInvite.mutate(
            { role: invite.role, pay_offer: request },
            { onSuccess: () => setOfferSheetVisible(false) }
          );
        },
      });
      return;
    }
    setPayOffer(request);
    setOfferSheetVisible(false);
  };

  // Which offer the sheet is editing: the not-yet-minted draft, or the
  // already-minted invite's offer once a code exists.
  const offerForEdit = hasStarted ? (invite?.pay_offer ?? null) : payOffer;

  const offerCard = (
    <Card testID="invite-offer-card" className="gap-3 p-4">
      {offerForEdit ? (
        <View className="gap-1">
          <InviteOfferSummary
            rate={formatRate(
              offerForEdit.rate_minor,
              offerForEdit.currency ?? currency
            )}
            startDate={formatDisplayDateWithYear(offerForEdit.valid_from)}
            cancellationPaidWithinHours={
              offerForEdit.cancellation_paid_within_hours
            }
          />
          <Small
            testID="invite-offer-draft-state"
            className="text-muted-foreground"
          >
            {t('invite.offer.draftState')}
          </Small>
          {/* Only once a code exists: there is no PATCH for `pay_offer`, so
              editing revokes this invite and mints a new one. A parent who
              has already texted the old code would otherwise find it dead
              with nothing on screen having said so. */}
          {hasStarted && invite ? (
            <Small
              testID="invite-offer-edit-replaces-code"
              className="text-muted-foreground"
            >
              {t('invite.offer.editReplacesCode')}
            </Small>
          ) : null}
          <Button
            testID="invite-offer-edit-button"
            variant="outline"
            disabled={isReplacingOffer}
            onPress={() => setOfferSheetVisible(true)}
          >
            <Text>{t('invite.offer.editButton')}</Text>
          </Button>
        </View>
      ) : (
        <Button
          testID="invite-offer-add-button"
          variant="outline"
          disabled={isReplacingOffer}
          onPress={() => setOfferSheetVisible(true)}
        >
          <Text>{t('invite.offer.addButton')}</Text>
        </Button>
      )}
    </Card>
  );

  return (
    <SetupScreenShell
      testID="manage-invite-screen"
      title={t('invite.manageTitle')}
      subtitle={t('invite.manageSubtitle')}
      ctaLabel={t('invite.doneButton')}
      onCta={() => router.back()}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      {hasStarted ? (
        // See InviteScreen: the shell centres its children, which left a void
        // above the code card once the picker was replaced by it.
        <View className="flex-1 justify-start gap-4">
          <InviteCodeCard
            invite={invite}
            isError={createInvite.isError}
            onRetry={onGenerate}
            onRevoke={onRevoke}
            isRevoking={revokeInvite.isPending}
          />
          <Button
            testID="invite-share-button"
            variant="outline"
            onPress={onShare}
            disabled={!code}
          >
            <Text>{t('invite.shareButton')}</Text>
          </Button>
          {/* P8: only a NANNY invite has anyone to price. */}
          {invite && invite.role === HOUSEHOLD_INVITE_ROLES.NANNY
            ? offerCard
            : null}
        </View>
      ) : (
        <>
          <InviteRolePicker
            selected={selectedRole}
            onSelect={setSelectedRole}
          />
          {/* No Skip control — absence of a drafted offer already reads as
              "no offer" (see InviteScreen). */}
          {selectedRole === HOUSEHOLD_INVITE_ROLES.NANNY ? offerCard : null}
          <Button
            testID="invite-generate-button"
            onPress={onGenerate}
            disabled={!onboarding.householdId}
          >
            <Text>{t('invite.generateButton')}</Text>
          </Button>
        </>
      )}

      <PayChangeSheet
        mode="offer"
        visible={offerSheetVisible}
        onDismiss={() => setOfferSheetVisible(false)}
        onSubmit={onSubmitOffer}
        isSubmitting={isReplacingOffer}
        currentArrangement={
          offerForEdit
            ? offerRequestToArrangementStub(offerForEdit, currency)
            : undefined
        }
        defaultCurrency={currency}
        initialEffectiveDateISO={offerForEdit?.valid_from}
        householdCancellationDefaultHours={
          household?.cancellation_paid_within_hours ?? 0
        }
        todayISO={todayISO}
        householdTimezone={timezone}
        householdWeekStartsOn={household?.week_starts_on ?? 0}
      />
    </SetupScreenShell>
  );
}
