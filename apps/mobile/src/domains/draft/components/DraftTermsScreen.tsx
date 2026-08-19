/**
 * @module domains/draft/components/DraftTermsScreen
 *
 * §4.1 — where the nanny writes the terms her draft home invites her to
 * write. Reached from all three of `DraftHomeScreen`'s terms CTAs; before
 * this existed they pushed at a route with no file behind it and landed on
 * `+not-found`.
 *
 * A PROPOSAL, NOT AN ARRANGEMENT. In a draft household nothing can insert a
 * `pay_arrangements` row — there is no owner and no parent, so
 * `WRITE_ROLES = {owner, parent}` matches nobody (D-36) — so what she writes
 * is a `terms_proposals` row, which is exactly what `useDraftProposal` reads
 * back onto the home screen. The binding act stays a parent's acceptance
 * (§17): she asks, she never sets anyone's pay.
 *
 * SAVING AN EDIT IS A NEW ROW. 092 allows at most one `proposed` round per
 * (household, carer), so re-writing her terms sends `supersedes_id` and the
 * answered row goes `countered`. Nothing is ever edited over — that is what
 * makes §7.2's "How we got here" a history rather than a UI convenience, and
 * it is why the server would 23505 an unsuperseded second round anyway.
 *
 * IT REBUILDS NO PART OF THE FORM (§4.1: "if 3-O ends up with a second terms
 * form, the reuse failed"). Required core, optional groups and the pay
 * schedule are 3-U1's `PayTermsRequiredCore` / `PayTermsGroups` /
 * `PayScheduleFields`; the seed and the submit payload are
 * `seedPayTermsFormState` / `buildCreatePayArrangementRequest`, the same two
 * functions the change sheet uses. The three deltas §4.1 lists are all this
 * file owns: device currency (a draft has no household currency), a start
 * date that may be in the future (already D-16's behaviour), and "Save my
 * terms" on the button.
 */
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Textarea } from '@/src/components/ui/textarea';
import { Label } from '@/src/components/ui/typography';
import { useDraftProposal } from '@/src/domains/draft/hooks/draftQueries';
import { proposalTermsToArrangement } from '@/src/domains/draft/utils/proposalTerms';
import { PayScheduleFields } from '@/src/domains/pay/components/PayScheduleFields';
import { PayTermsGroups } from '@/src/domains/pay/components/PayTermsGroups';
import { PayTermsRequiredCore } from '@/src/domains/pay/components/PayTermsRequiredCore';
import {
  blankPayTermsFormState,
  buildCreatePayArrangementRequest,
  firstPayTermsBlocker,
  type PayTermsFormState,
  seedPayTermsFormState,
} from '@/src/domains/pay/utils/payArrangementForm';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import {
  getNextSetupStep,
  getSetupStepRoute,
  getStepProgress,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { goBackOrHome } from '@/src/lib/goBack';
import { localDateInZone } from '@/src/lib/localDate';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const TEST_ID_PREFIX = 'draft-terms-form';

/**
 * A save refused because her open round moved under her. The generic
 * `errors:conflict` toast ("refresh and try again") is honest advice on a
 * list screen and useless here — this form has no refresh affordance, so the
 * screen does the refreshing itself and says so inline instead.
 */
function isConflict(error: unknown): boolean {
  const envelope = (error ?? {}) as {
    response?: { status?: number; data?: { error?: { code?: string } } };
  };
  return (
    envelope.response?.status === 409 ||
    envelope.response?.data?.error?.code === 'CONFLICT'
  );
}

export function DraftTermsScreen() {
  const { t } = useTranslation('draft');
  const { t: tPay } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();

  const { household, householdId } = useActiveHousehold();
  // She proposes for HERSELF and nobody else. The service ignores the carer
  // id in the URL when the caller is the carer, but the route still needs
  // one, and her own is the only honest value to send.
  const carerId = useAuthStore(s => s.user?.id) ?? '';

  // MID-WIZARD OR NOT — the one question that decides what a save does here.
  // `currentStep === TERMS` is the honest test: every finish path calls
  // `useSetupProgressStore.reset()`, so a nanny who reached this form from
  // her draft home cannot be sitting on the TERMS step. When she IS on it,
  // saving has to move the machine on; leaving `currentStep` on TERMS is why
  // `getUnfinishedSetupResumeRoute` relaunched her into this same form on
  // every cold start, with a Back button that went nowhere she wanted.
  const setupRole = useSetupProgressStore(s => s.role);
  const setupPath = useSetupProgressStore(s => s.path);
  const setCurrentStep = useSetupProgressStore(s => s.setCurrentStep);
  const onTermsStep =
    useSetupProgressStore(s => s.currentStep) === SETUP_STEPS.TERMS;
  const nextStep = onTermsStep
    ? getNextSetupStep(setupRole, setupPath, SETUP_STEPS.TERMS)
    : null;

  const proposalQuery = useDraftProposal(householdId ?? undefined);
  const proposal = proposalQuery.data ?? null;
  const propose = useProposeTerms(householdId ?? '', carerId);

  // A draft has no household currency of its own (§4.1) — hers comes from the
  // device as a PREFILL, overridable in the select, and travels on the
  // proposal rather than on a household column nobody has filled in.
  const todayISO = localDateInZone(household?.timezone ?? 'UTC');
  const [form, setForm] = useState<PayTermsFormState>(() =>
    blankPayTermsFormState(household?.currency ?? getDeviceCurrency(), todayISO)
  );
  const patch = (next: Partial<PayTermsFormState>) =>
    setForm(current => ({ ...current, ...next }));

  // Seed ONCE, the first time the proposal query has an answer — the same
  // `hasSeededRef` discipline `PaySetupScreen` uses, so a background refetch
  // can never clobber what she is mid-typing. A null answer is a real answer
  // (she has not written her terms yet) and leaves the blank form alone.
  const hasSeededRef = useRef(false);
  const [hadConflict, setHadConflict] = useState(false);
  useEffect(() => {
    if (hasSeededRef.current || proposalQuery.isPending) return;
    hasSeededRef.current = true;
    if (!proposal) return;
    setForm(
      seedPayTermsFormState(
        proposalTermsToArrangement(proposal.terms, {
          proposalId: proposal.id,
          householdId: proposal.household_id,
          carerId: proposal.carer_id,
          carerDisplayName: proposal.carer_display_name,
        }),
        household?.cancellation_paid_within_hours ?? 0,
        todayISO,
        // Her stated start date survives the edit: "starting Monday 17 Aug"
        // is the normal interview case, not an edge one (§4.1).
        proposal.terms.valid_from
      )
    );
  }, [
    proposal,
    proposalQuery.isPending,
    household?.cancellation_paid_within_hours,
    todayISO,
  ]);

  // A FAILED read is not "she has no round yet". Saving on top of a failed
  // read sends no `supersedes_id`, the server refuses the second open round
  // (092's partial unique index) and she gets a 409 no amount of refreshing
  // clears. Refuse the save instead, and say why.
  const termsReadFailed = proposalQuery.isError;
  const request = buildCreatePayArrangementRequest({ ...form, todayISO });
  const canSave =
    Boolean(request) && !!householdId && !propose.isPending && !termsReadFailed;
  // Name the missing answer instead of leaving a greyed-out button to explain
  // itself — the cancellation term has no blank state, so a form that looks
  // finished can still refuse.
  const blocker = firstPayTermsBlocker({ ...form, todayISO });

  const handleSubmit = async () => {
    if (!request || !householdId) return;
    setHadConflict(false);
    try {
      await propose.mutateAsync({
        terms: request,
        // Present only when she already has an open round — see the header.
        ...(proposal ? { supersedes_id: proposal.id } : {}),
      });
      showSuccessToast(t('termsForm.savedToast'));
      if (nextStep) {
        // Mid-wizard: ADVANCE, don't go back. Going back from here left
        // `currentStep` on TERMS forever.
        setCurrentStep(nextStep);
        router.push(getSetupStepRoute(nextStep, setupRole, setupPath) as Href);
        return;
      }
      // Never a bare `back()`: reached by reload or deep link this screen is
      // the bottom of its stack, where `back()` is a no-op — a saved round
      // that leaves her staring at the same filled form reads as a failure.
      goBackOrHome(router);
    } catch (error) {
      // A 409 means her open round moved while this form was on screen (a
      // second device, or the parent answering it). The generic toast tells
      // her to refresh a screen with nothing to refresh WITH, so do the
      // refresh here: re-read the round, let the seed effect run again, and
      // say what happened above the button.
      if (isConflict(error)) {
        setHadConflict(true);
        hasSeededRef.current = false;
        void proposalQuery.refetch();
      }
      // `useProposeTerms`'s onError already surfaced a toast; keep the form
      // as typed (same discipline as PayChangeSheet and PaySetupScreen).
    }
  };

  return (
    <SetupScreenShell
      testID={TEST_ID_PREFIX}
      title={t('termsForm.title')}
      subtitle={t('termsForm.subtitle')}
      ctaLabel={t('termsForm.submitButton')}
      onCta={() => void handleSubmit()}
      ctaDisabled={!canSave}
      progress={
        nextStep
          ? getStepProgress(setupRole, setupPath, SETUP_STEPS.TERMS)
          : undefined
      }
      ctaHint={
        termsReadFailed
          ? t('termsForm.couldntCheckHint')
          : hadConflict
            ? t('termsForm.conflictError')
            : blocker
              ? tPay(`blocker.${blocker}`)
              : undefined
      }
      onBack={() => goBackOrHome(router)}
      backLabel={tCommon('back')}
    >
      <PayTermsRequiredCore
        testIDPrefix={TEST_ID_PREFIX}
        state={form}
        onChange={patch}
        todayISO={todayISO}
      />

      {/* No `seed`: a proposal prices nothing, so D-6's stored weekly-
          equivalent line has nothing to render from here — the only weekly
          figure this domain may print is the server's, on the home screen. */}
      <PayTermsGroups
        testIDPrefix={TEST_ID_PREFIX}
        state={form}
        onChange={patch}
        seed={null}
      />

      <PayScheduleFields
        testIDPrefix={TEST_ID_PREFIX}
        t={tPay}
        payFrequency={form.payFrequency}
        onPayFrequencyChange={payFrequency => patch({ payFrequency })}
        payDayOfWeekText={form.payDayOfWeekText}
        onPayDayOfWeekTextChange={payDayOfWeekText =>
          patch({ payDayOfWeekText })
        }
        payDayOfMonthText={form.payDayOfMonthText}
        onPayDayOfMonthTextChange={payDayOfMonthText =>
          patch({ payDayOfMonthText })
        }
      />

      <View className="gap-2">
        <Label>{tPay('changeSheet.noteLabel')}</Label>
        <Textarea
          testID={`${TEST_ID_PREFIX}-note-input`}
          accessibilityLabel={tPay('changeSheet.noteLabel')}
          value={form.note}
          onChangeText={note => patch({ note })}
          placeholder={tPay('changeSheet.notePlaceholder')}
        />
      </View>
    </SetupScreenShell>
  );
}
