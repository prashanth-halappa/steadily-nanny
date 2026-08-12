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
import { useRouter } from 'expo-router';
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
  type PayTermsFormState,
  seedPayTermsFormState,
} from '@/src/domains/pay/utils/payArrangementForm';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { localDateInZone } from '@/src/lib/localDate';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';

const TEST_ID_PREFIX = 'draft-terms-form';

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

  const request = buildCreatePayArrangementRequest({ ...form, todayISO });
  const canSave = Boolean(request) && !!householdId && !propose.isPending;

  const handleSubmit = async () => {
    if (!request || !householdId) return;
    try {
      await propose.mutateAsync({
        terms: request,
        // Present only when she already has an open round — see the header.
        ...(proposal ? { supersedes_id: proposal.id } : {}),
      });
      showSuccessToast(t('termsForm.savedToast'));
      router.back();
    } catch {
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
      onBack={() => router.back()}
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
