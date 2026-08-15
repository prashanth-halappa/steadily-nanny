/**
 * @module domains/setup/components/InviteScreen
 *
 * Parent setup step 3 (final): generate an invite code for a chosen role and
 * share it. No native clipboard module is wired up (would need a dev-client
 * rebuild), so "copy" is covered by the OS share sheet, which offers Copy
 * natively, plus the code itself being selectable text.
 *
 * The code is minted by an EXPLICIT tap, never automatically on mount. The
 * auto-mint version fired a single `useEffect` the moment `householdId` was
 * present — which, in the wizard, is before the parent has touched the role
 * picker — so every wizard invite was silently `role: 'nanny'` regardless of
 * what was picked, and the `hasRequestedInvite` ref blocked any later
 * re-mint. Same shape as `ManageInviteScreen` now: pick a role, then
 * generate, and one tap mints exactly one code.
 *
 * NOT the last wizard step — advances to NOTIFICATIONS_PERMISSION, same
 * pattern as CodeEntryScreen advancing to AVAILABILITY. See
 * `getNextSetupStep` in `domains/setup/types`.
 */

import type { HouseholdInviteRole } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HOUSEHOLD_INVITE_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { CreatePayArrangementRequest } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { PayChangeSheet } from '@/src/domains/pay/components/PayChangeSheet';
import {
  formatDisplayDateWithYear,
  offerRequestToArrangementStub,
} from '@/src/domains/pay/utils/payArrangementForm';
import { InviteCodeCard } from '@/src/domains/setup/components/InviteCodeCard';
import { InviteRolePicker } from '@/src/domains/setup/components/InviteRolePicker';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useRevokeInvite } from '@/src/hooks/mutations/useRevokeInvite';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { localDateInZone } from '@/src/lib/localDate';
import { formatRate } from '@/src/lib/money';
import { useSetupProgressStore } from '@/src/store/setupProgress';

export function InviteScreen() {
  const router = useRouter();
  const { t } = useTranslation('household');
  const householdId = useSetupProgressStore(s => s.householdId);
  const role = useSetupProgressStore(s => s.role);
  const path = useSetupProgressStore(s => s.path);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const createInvite = useCreateInvite(householdId ?? '');
  const revokeInvite = useRevokeInvite(householdId ?? '');
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedRole, setSelectedRole] = useState<HouseholdInviteRole>(
    HOUSEHOLD_INVITE_ROLES.NANNY
  );

  // P8 — a pay OFFER drafted alongside a nanny invite (§ InviteScreen module
  // doc for the wire contract). Purely local until Generate is tapped: the
  // offer rides the SAME createInvite call that mints the code, never a
  // second request.
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

  // One tap = one code. Changing the role selection never mints anything on
  // its own, so the picker stays free of duplicate-code side effects.
  const onGenerate = () => {
    if (!householdId || createInvite.isPending) return;
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

  // Clears BOTH the mutation state InviteCodeCard reads (`createInvite`'s
  // `data`) and the local `hasStarted` flag — resetting only the former
  // leaves the card stuck on its loading spinner instead of returning to
  // the role picker so the parent can mint a fresh code.
  const onRevoke = () => {
    if (!invite) return;
    revokeInvite.mutate(invite.id, {
      onSuccess: () => {
        createInvite.reset();
        setHasStarted(false);
      },
    });
  };

  const onContinue = () => {
    setCurrentStep(SETUP_STEPS.NOTIFICATIONS_PERMISSION);
    router.push(
      getSetupStepRoute(SETUP_STEPS.NOTIFICATIONS_PERMISSION) as Href
    );
  };

  return (
    <SetupScreenShell
      testID="invite-screen"
      progress={getStepProgress(role, path, SETUP_STEPS.INVITE)}
      title={t('invite.wizardTitle')}
      subtitle={t('invite.wizardSubtitle')}
      ctaLabel={t('invite.continueButton')}
      ctaDisabled={!code}
      onCta={onContinue}
    >
      {hasStarted ? (
        // flex-1 + justify-start defeats the shell's vertical centring, which
        // stranded the code card mid-screen under a void of empty space.
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
        </View>
      ) : (
        <>
          <InviteRolePicker
            selected={selectedRole}
            onSelect={setSelectedRole}
          />
          {/* P8: an offer only means something on a NANNY invite — pay is
              per-carer, and a co-parent/helper invite has nobody to price. No
              Skip control — absence of a drafted offer already reads as "no
              offer", so a Skip button would imply a decision was required. */}
          {selectedRole === HOUSEHOLD_INVITE_ROLES.NANNY ? (
            <Card testID="invite-offer-card" className="gap-3 p-4">
              {payOffer ? (
                <View className="gap-1">
                  <Body testID="invite-offer-summary">
                    {t('invite.offer.summary', {
                      rate: formatRate(
                        payOffer.rate_minor,
                        payOffer.currency ?? currency
                      ),
                      date: formatDisplayDateWithYear(payOffer.valid_from),
                    })}
                  </Body>
                  <Small
                    testID="invite-offer-draft-state"
                    className="text-muted-foreground"
                  >
                    {t('invite.offer.draftState')}
                  </Small>
                  <Button
                    testID="invite-offer-edit-button"
                    variant="outline"
                    onPress={() => setOfferSheetVisible(true)}
                  >
                    <Text>{t('invite.offer.editButton')}</Text>
                  </Button>
                </View>
              ) : (
                <Button
                  testID="invite-offer-add-button"
                  variant="outline"
                  onPress={() => setOfferSheetVisible(true)}
                >
                  <Text>{t('invite.offer.addButton')}</Text>
                </Button>
              )}
            </Card>
          ) : null}
          <Button
            testID="invite-generate-button"
            onPress={onGenerate}
            disabled={!householdId}
          >
            <Text>{t('invite.generateButton')}</Text>
          </Button>
        </>
      )}

      <PayChangeSheet
        mode="offer"
        visible={offerSheetVisible}
        onDismiss={() => setOfferSheetVisible(false)}
        onSubmit={request => {
          setPayOffer(request);
          setOfferSheetVisible(false);
        }}
        isSubmitting={false}
        currentArrangement={
          payOffer
            ? offerRequestToArrangementStub(payOffer, currency)
            : undefined
        }
        defaultCurrency={currency}
        initialEffectiveDateISO={payOffer?.valid_from}
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
