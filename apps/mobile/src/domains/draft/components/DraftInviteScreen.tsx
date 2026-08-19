/**
 * @module domains/draft/components/DraftInviteScreen
 *
 * The nanny-create wizard's INVITE step — the step her sequence did not have.
 * She signed up, made a draft, wrote her terms, and the wizard walked her
 * past availability into permission prompts without ever offering a way to
 * send those terms to anyone. The only door was a card on the draft home she
 * had to find unaided.
 *
 * NOT `/onboarding/invite`. That screen is parent-shaped: it asks which role
 * the code grants and offers to attach a pay offer, and it sits under
 * `onboarding/_layout`, which bounces any user the server already calls
 * onboarded — which a nanny holding a draft membership is. Same two reasons
 * the TERMS step already routes to `(private)/draft/terms`.
 *
 * IT BUILDS NO SHARE UI. The sheet is `ShareTermsSheet` verbatim, the mint is
 * `useCreateInvite` with `role: 'parent'` — the family redeeming her draft
 * becomes its parent, so the invite grants the role the OTHER side takes.
 * Both are exactly what `DraftHomeScreen` already does; a second share sheet
 * here would be two surfaces drifting apart over one code.
 *
 * THE SKIP IS NOT DECORATION. She may have no family to send to yet — the
 * interview is next Tuesday. Forcing a code she cannot send is how a draft
 * gets abandoned, so "I'll do this later" takes the same transition sending
 * does, leaving `currentStep` moved on and nothing minted.
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useCreateInvite } from '@/src/hooks/mutations/useCreateInvite';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnline } from '@/src/lib/network';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { useDraftProposal } from '../hooks/draftQueries';
import { type ShareTermsInput, ShareTermsSheet } from './ShareTermsSheet';

const TEST_ID = 'draft-invite-screen';
const HOME_ROUTE = '/(private)/(tabs)/home' as Href;

export function DraftInviteScreen() {
  const { t } = useTranslation('draft');
  const router = useRouter();
  const isOnline = useIsOnline();

  const setupRole = useSetupProgressStore(s => s.role);
  const setupPath = useSetupProgressStore(s => s.path);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const { householdId } = useActiveHousehold();
  const createInvite = useCreateInvite(householdId ?? '');
  const proposalQuery = useDraftProposal(householdId ?? undefined);

  const [shareOpen, setShareOpen] = useState(false);
  const [invite, setInvite] = useState<HouseholdInvite | null>(null);

  const advance = () => {
    const next = getNextSetupStep(setupRole, setupPath, SETUP_STEPS.INVITE);
    if (!next) {
      router.replace(HOME_ROUTE);
      return;
    }
    setCurrentStep(next);
    router.push(getSetupStepRoute(next, setupRole, setupPath) as Href);
  };

  const onCreate = async (input: ShareTermsInput) => {
    const minted = await createInvite.mutateAsync({
      // The family redeeming her draft becomes its parent — the invite grants
      // the role the OTHER side takes, not hers.
      role: 'parent',
      ...(input.label === undefined ? {} : { label: input.label }),
      link_expires_in_days: input.linkExpiresInDays,
    });
    setInvite(minted);
    // Close BEFORE advancing: the sheet's own `.then` fires the OS share
    // sheet right after this resolves, and stacking that on top of a bottom
    // sheet the navigator is unmounting is GOLDEN-FIXES #1 territory.
    setShareOpen(false);
    advance();
    return minted;
  };

  return (
    <>
      <SetupScreenShell
        testID={TEST_ID}
        progress={getStepProgress(setupRole, setupPath, SETUP_STEPS.INVITE)}
        title={t('inviteStep.title')}
        subtitle={t('inviteStep.subtitle')}
        ctaLabel={t('inviteStep.cta')}
        onCta={() => setShareOpen(true)}
        ctaDisabled={!isOnline || !householdId}
        ctaHint={isOnline ? undefined : t('inviteStep.offlineHint')}
        onSkip={advance}
        skipLabel={t('inviteStep.skip')}
      />

      <ShareTermsSheet
        visible={shareOpen}
        onDismiss={() => setShareOpen(false)}
        invite={invite}
        isMinting={createInvite.isPending}
        isError={createInvite.isError}
        onCreate={onCreate}
        nannyName={proposalQuery.data?.carer_display_name ?? ''}
      />
    </>
  );
}
