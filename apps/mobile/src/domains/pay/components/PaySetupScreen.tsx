/**
 * @module domains/pay/components/PaySetupScreen
 *
 * "Set up pay for {name}" — TIER0-PLAN.md owner decision 8 / TIER0-CX-SPEC.md
 * §2 "First-time setup". A full screen (not a sheet) — the required core plus
 * a keyboard is past `fitContent` territory — reached from the prompt card on
 * Manage household and every no-arrangement empty state in this domain.
 *
 * Required core at the top, always open; every optional term behind a
 * `TermGroup` via the shared `PayTermsGroups` (D-3). There is no seed
 * arrangement here, so §4.2's "a group opens when it has a value" resolves to
 * "everything closed" — the same rule the change sheet uses, reading as a
 * short required form rather than as a document.
 *
 * P1: this SENDS the terms, it does not save them. `pay_arrangements` has
 * exactly one writer now (`termsProposalCommandService.accept`), so what
 * this screen submits is a `terms_proposals` round the nanny has to agree
 * to — which is what makes "an arrangement exists" and "someone tapped
 * Agree" the same fact, and what stops the clock-in gate opening against
 * terms she never saw. With a round already open the screen renders the
 * RECEIPT (or a route to hers) instead of a form: 092 allows one `proposed`
 * row per (household, carer), and the old blank-form path would have
 * collided with it.
 *
 * Two differences from `PayChangeSheet`, both load-bearing:
 *  - the effective date defaults to the day she JOINED the household (when
 *    that is in the past, so already-worked weeks price), not today;
 *  - the cancellation chips start UNSELECTED even though the hours field is
 *    pre-filled from the household's current window — "this is the one term
 *    where silence breeds the dispute" (spec). Save stays disabled until one
 *    is tapped.
 */
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, Label } from '@/src/components/ui/typography';
import { PayScheduleFields } from '@/src/domains/pay/components/PayScheduleFields';
import { PayTermsGroups } from '@/src/domains/pay/components/PayTermsGroups';
import { PayTermsRequiredCore } from '@/src/domains/pay/components/PayTermsRequiredCore';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useWithdrawTerms } from '@/src/hooks/mutations/useWithdrawTerms';
import { onboardingAsQuery, queryState } from '@/src/hooks/queries/queryState';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  findOpenTermsProposal,
  useTermsProposals,
} from '@/src/hooks/queries/useTermsProposals';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { localDateInZone } from '@/src/lib/localDate';
import {
  blankPayTermsFormState,
  buildCreatePayArrangementRequest,
  type PayTermsFormState,
} from '../utils/payArrangementForm';
import { TermsSentReceipt } from './TermsSentReceipt';

function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function PaySetupScreen() {
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const router = useRouter();
  const params = useLocalSearchParams<{ carerId?: string | string[] }>();
  const carerId = normalizeParam(params.carerId);

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const householdId = activeHousehold.householdId;
  const household = activeHousehold.household;
  const members = useHouseholdMembers(householdId);
  // Whether a current arrangement already exists for this carer — if it
  // does, this screen was reached a second time (e.g. the prompt-card link
  // stayed reachable after someone else already set her terms), and seeding
  // the day she joined would silently backdate a change she may not intend.
  // Default to today instead in that case (review finding 9).
  const currentArrangement = useCurrentPayArrangement(
    householdId,
    carerId ?? null
  );
  // §7.1's live negotiation. Post-P1 this is the OTHER thing that can be
  // true on arrival: an arrangement is null until she agrees, so the old
  // `currentArrangement`-only gate showed a blank form over an open round —
  // and sending it would 23505 against 092's partial unique index.
  const proposals = useTermsProposals(householdId, carerId ?? null);
  const openProposal = findOpenTermsProposal(proposals.data);
  const proposeTerms = useProposeTerms(householdId ?? '', carerId ?? '');
  const withdrawTerms = useWithdrawTerms(openProposal?.id ?? '');

  const member = (members.data ?? []).find(m => m.user_id === carerId);
  const carerName = resolveCarerName(member, tSettings('role.nanny'));
  const timezone = household?.timezone ?? 'UTC';
  const todayISO = localDateInZone(timezone);
  const householdCancellationDefaultHours =
    household?.cancellation_paid_within_hours ?? 0;

  // Device Language & Region as a PREFILL only — the select below always lets
  // it be overridden, because currency belongs to the employment arrangement
  // and not to whichever phone happens to be creating it.
  const [form, setForm] = useState<PayTermsFormState>(() =>
    blankPayTermsFormState(getDeviceCurrency(), todayISO)
  );
  const patch = (next: Partial<PayTermsFormState>) =>
    setForm(current => ({ ...current, ...next }));

  // Seed the effective-date default and the cancellation-hours prefill ONCE,
  // the first time both the member and household have loaded — mirrors
  // ManageHouseholdScreen's hasSeededRef pattern, so a background refetch
  // never clobbers what the parent is mid-typing.
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (
      hasSeededRef.current ||
      !member ||
      !household ||
      currentArrangement.isPending
    ) {
      return;
    }
    hasSeededRef.current = true;
    // Only seed the joined-date default when there is genuinely no current
    // arrangement yet — the first-time-setup case the screen is named for.
    // A current arrangement already existing means "today" is the honest
    // default (review finding 9).
    const joinedDateISO = localDateInZone(timezone, new Date(member.joined_at));
    setForm(current => ({
      ...current,
      // Household currency over the device prefill, once the household has
      // loaded — currency belongs to the household's employment arrangements,
      // not to whichever phone happened to create this one.
      currency: household.currency ?? getDeviceCurrency(),
      effectiveDateISO:
        !currentArrangement.data && joinedDateISO < todayISO
          ? joinedDateISO
          : current.effectiveDateISO,
      todayISO,
      cancellationHoursText:
        householdCancellationDefaultHours > 0
          ? String(householdCancellationDefaultHours)
          : '',
    }));
  }, [
    member,
    household,
    timezone,
    todayISO,
    householdCancellationDefaultHours,
    currentArrangement.isPending,
    currentArrangement.data,
  ]);

  // Setup is first-time only. An existing arrangement means we were reached
  // via a stale stack or deep link — bounce to the pay hub before a blank
  // form can append a destructive half-null row. PayChangeSheet owns edits.
  // A `useEffect`, not a call during render: every other redirect in this
  // codebase (`app/index.tsx`, `(private)/_layout.tsx`) fires from an
  // effect, never synchronously while rendering.
  useEffect(() => {
    if (currentArrangement.data) {
      router.replace('/settings/pay' as Href);
    }
  }, [currentArrangement.data, router]);

  // C6 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): `onboarding.status`
  // stays 'loading' FOREVER on a failed memberships read — checking that
  // alone made this a permanent spinner with no reachable retry.
  const onboardingQs = queryState(onboardingAsQuery(onboarding));
  if (onboardingQs.status === 'error') {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <ErrorState variant="network" onRetry={onboardingQs.retry} />
      </View>
    );
  }

  if (onboardingQs.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (!isParentEditorRole(onboarding.role) || onboarding.isPastMember) {
    return (
      <View testID="pay-setup-not-available" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackButton
            testID="pay-setup-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <View
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('notAvailableTitle')}
            description={t('notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  if (
    !householdId ||
    !carerId ||
    members.isPending ||
    currentArrangement.isPending ||
    proposals.isPending
  ) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  // Setup is first-time only. An existing arrangement means we were reached
  // via a stale stack or deep link — bounce to the pay hub before a blank
  // form can append a destructive half-null row. PayChangeSheet owns edits.
  // The render-time check below only decides WHAT to render (never call a
  // router method during render — every other redirect in this codebase,
  // e.g. `app/index.tsx` and `(private)/_layout.tsx`, fires from a
  // `useEffect`); the actual `router.replace` call lives in the effect above.
  if (currentArrangement.data) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  // ONE condition, two bugs. A round is already open, so there is nothing to
  // set: the parent gets the RECEIPT for what he sent (persistent, not a
  // toast — `screens-today.md` Table B) or a route to what SHE sent. A blank
  // form here would invite a second `proposed` row that 092 refuses.
  if (openProposal) {
    return (
      <View testID="pay-setup-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
          className="gap-4"
        >
          <BackButton
            testID="pay-setup-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
          {openProposal.direction === 'parent' ? (
            <TermsSentReceipt
              proposal={openProposal}
              counterpartyName={carerName}
              householdTimezone={timezone}
              viewer="parent"
              onWithdraw={() => withdrawTerms.mutate()}
              isWithdrawing={withdrawTerms.isPending}
            />
          ) : (
            <Card testID="pay-setup-open-proposal">
              <CardContent className="gap-2">
                <Body weight="medium">
                  {t('proposal.openRowTitleReceived', { name: carerName })}
                </Body>
                <Button
                  testID="pay-setup-open-proposal-review"
                  variant="ghost"
                  className="self-start px-0"
                  onPress={() =>
                    router.push(`/pay/proposal/${openProposal.id}` as Href)
                  }
                >
                  <Text>{t('proposal.reviewButton')}</Text>
                </Button>
              </CardContent>
            </Card>
          )}
        </View>
      </View>
    );
  }

  const request = buildCreatePayArrangementRequest({ ...form, todayISO });

  /**
   * P1: this SENDS A ROUND. There is no toast and no bounce — the receipt
   * this screen renders for an open round IS the confirmation, and it is
   * still there tomorrow.
   *
   * No `supersedes_id` here, and that is not an omission: the branch above
   * returns before this form ever renders while a round is open, so a first
   * round is the only thing this path can send. `PayArrangementScreen`, which
   * DOES keep its form reachable beside an open round, seeds it there.
   */
  const handleSubmit = async () => {
    if (!request) return;
    try {
      await proposeTerms.mutateAsync({ terms: request });
    } catch {
      // useProposeTerms' onError already surfaced a toast; keep the form as
      // typed (same discipline as PayChangeSheet).
    }
  };

  return (
    <SetupScreenShell
      testID="pay-setup-screen"
      title={t('setup.title', { name: carerName })}
      subtitle={t('setup.subtitle', { name: carerName })}
      ctaLabel={t('setup.submitButton', { name: carerName })}
      onCta={() => void handleSubmit()}
      ctaDisabled={!request || proposeTerms.isPending}
      onBack={() => router.back()}
      backLabel={tCommon('back')}
    >
      <PayTermsRequiredCore
        testIDPrefix="pay-setup"
        state={form}
        onChange={patch}
        todayISO={todayISO}
      />

      {/* No `seed` — there is no arrangement yet, so every group is closed
          and D-6's weekly-equivalent line has nothing stored to render. */}
      <PayTermsGroups
        testIDPrefix="pay-setup"
        state={form}
        onChange={patch}
        seed={null}
      />

      {/* 082's pay schedule (D-17, T7 reversal) — presentation only, not part
          of PayTermsGroups' D-3 expanders (spec §4.3 lists it as its own,
          always-visible block, same as the required core). */}
      <PayScheduleFields
        testIDPrefix="pay-setup"
        t={t}
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
        <Label>{t('changeSheet.noteLabel')}</Label>
        <Textarea
          testID="pay-setup-note-input"
          accessibilityLabel={t('changeSheet.noteLabel')}
          value={form.note}
          onChangeText={note => patch({ note })}
          placeholder={t('changeSheet.notePlaceholder')}
        />
      </View>
    </SetupScreenShell>
  );
}
