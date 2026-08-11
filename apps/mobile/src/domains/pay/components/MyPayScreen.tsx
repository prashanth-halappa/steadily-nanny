/**
 * @module domains/pay/components/MyPayScreen
 *
 * Surface B — "My pay" (TIER0-CX-SPEC.md §3), the nanny's read-only view:
 * one card per household she belongs to, each fetched independently through
 * `useCurrentPayArrangement`/`usePayArrangementHistory` for that household.
 * The subtitle sentence is the anonymity promise stated once, verbatim from
 * the spec — it is the whole reason `pto_ledger`/`pay_arrangements` never
 * carry a cross-household reference (docs/11-MONEY.md).
 *
 * Nanny-only, defense in depth (the settings.tsx row already gates this to
 * the nanny role, but the route is reachable by URL regardless) — a helper
 * or parent deep-linking here sees an honest not-available state, same
 * pattern as `ManageHouseholdScreen`'s.
 *
 * 3-O §9.1: this screen is no longer read-only. It gains exactly ONE write
 * per household card — "Suggest a change" — and with it the write gate its
 * old header comment said it did not need: a nanny a family has removed must
 * not be able to propose new terms to them. `useIsOnboarded` already exposes
 * `isPastMember`; that is the whole gate.
 *
 * A proposal from My pay is the SAME object as a nanny-first onboarding
 * proposal, reviewed on the same screen and accepted through the same sheet.
 * One lifecycle, not two — which is what "both directions everywhere" buys.
 *
 * D-31/D-41 (`docs/design/screens-pay-terms.md` §8.2/§8.3): pressing "I've
 * seen these terms" records the DATE SHE SAW THEM and nothing more. Every
 * string this screen renders for that fact says so — "Seen by {name} on
 * {date}", never a word implying she agreed to them. The ack gates NOTHING:
 * all terms, all history, and every figure read the same before and after.
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { InlineError } from '@/src/components/ui/inline-error';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useAckPayArrangement } from '@/src/hooks/mutations/useAckPayArrangement';
import { useDissentPayArrangement } from '@/src/hooks/mutations/useDissentPayArrangement';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useWithdrawTerms } from '@/src/hooks/mutations/useWithdrawTerms';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { usePastHouseholds } from '@/src/hooks/queries/usePastHouseholds';
import { usePayArrangementAcks } from '@/src/hooks/queries/usePayArrangementAcks';
import { usePayArrangementHistory } from '@/src/hooks/queries/usePayArrangementHistory';
import { usePtoBalance } from '@/src/hooks/queries/usePtoBalance';
import { useTermsProposals } from '@/src/hooks/queries/useTermsProposals';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney } from '@/src/lib/money';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';
import { resolveAckState } from '../utils/ackState';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import {
  proposalHistoryLabel,
  proposalStateWord,
} from '../utils/proposalTerms';
import { buildTermsDiff, summarizeTermsDiff } from '../utils/termsDiff';
import { BackRow } from './BackRow';
import { PayChangeSheet } from './PayChangeSheet';
import { TermsDocumentRows } from './TermsDocumentRows';

/**
 * The version immediately before `id` in the append-only history (newest
 * first), or `null` when `id` IS the first terms ever set — the `previous`
 * argument `buildTermsDiff` takes.
 */
function previousVersion(
  history: readonly PayArrangement[] | undefined,
  id: string
): PayArrangement | null {
  const index = history?.findIndex(row => row.id === id) ?? -1;
  if (index < 0) return null;
  return history?.[index + 1] ?? null;
}

/**
 * §8.3.1's dissent sheet. Her words, optional, capped at the wire schema's
 * 280 — and the copy under the field states plainly that this records her
 * side and changes nothing, because a nanny who has been burned will read
 * any button on a pay screen as a waiver unless told otherwise.
 */
function DissentSheet({
  householdId,
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
}: {
  householdId: string;
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (note: string | undefined) => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation('pay');
  const [note, setNote] = useState('');

  return (
    <BottomSheetBase
      sheetId={`pay-dissent-${householdId}`}
      visible={visible}
      onDismiss={onDismiss}
      testID={`my-pay-dissent-sheet-${householdId}`}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('dissent.title')}</H4>
        <Textarea
          testID={`my-pay-dissent-note-${householdId}`}
          accessibilityLabel={t('dissent.title')}
          value={note}
          onChangeText={setNote}
          placeholder={t('dissent.placeholder')}
          maxLength={280}
        />
        <Small className="text-muted-foreground">{t('dissent.hint')}</Small>
        <LoadingButton
          testID={`my-pay-dissent-submit-${householdId}`}
          label={t('dissent.submit')}
          isLoading={isSubmitting}
          onPress={() => onSubmit(note.trim() === '' ? undefined : note.trim())}
        />
      </View>
    </BottomSheetBase>
  );
}

function MyPayHouseholdCard({
  household,
  carerId,
  canWrite,
}: {
  household: Household;
  carerId: string;
  /** §9.1's one gate: false for a household she was removed from. She keeps
   * every figure she earned there and loses the ability to propose new terms
   * to a family she no longer works for. */
  canWrite: boolean;
}) {
  const { t } = useTranslation('pay');
  const router = useRouter();
  const current = useCurrentPayArrangement(household.id, carerId);
  const history = usePayArrangementHistory(household.id, carerId);
  const acks = usePayArrangementAcks(household.id, carerId, current.data?.id);
  const ackTerms = useAckPayArrangement(household.id, carerId);
  const dissentTerms = useDissentPayArrangement(household.id, carerId);
  const proposals = useTermsProposals(household.id, carerId);
  const proposeTerms = useProposeTerms(household.id, carerId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dissentOpen, setDissentOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const elevation = useElevation();

  // This household's own local year — each card is per-family, so the
  // year the balance covers is THAT family's calendar, not the device's.
  const currentYear = Number(localDateInZone(household.timezone).slice(0, 4));
  const hasEntitlement = current.data?.pto_entitlement_minutes_per_year != null;
  const balance = usePtoBalance(
    household.id,
    carerId,
    hasEntitlement ? currentYear : undefined
  );

  const arrangement = current.data;
  const ackState = resolveAckState(acks.data);
  const previous = arrangement
    ? previousVersion(history.data, arrangement.id)
    : null;
  // Household-local, because the date she saw her terms is a date in HER
  // working week, not in whatever zone the device happens to sit in.
  const ackDate =
    ackState.kind === 'none'
      ? null
      : formatDisplayDateWithYear(
          localDateInZone(household.timezone, new Date(ackState.createdAt))
        );
  // Exactly one proposal can be open at a time; everything else is history —
  // one read, not a `current` and a `history` that can disagree.
  const openProposal = (proposals.data ?? []).find(
    row => row.status === 'proposed'
  );
  // Unconditional, like every hook: an empty id simply has nothing to
  // withdraw, and the button that would call it is not on screen.
  const withdrawTerms = useWithdrawTerms(openProposal?.id ?? '');
  // A household with no name yet is still a household she is negotiating
  // with — it reads as "the family" rather than as a blank.
  const householdName = household.name ?? t('proposal.theFamily');
  const openProposalState = openProposal
    ? proposalStateWord(
        openProposal,
        { counterpartyName: householdName, timezone: household.timezone },
        t
      )
    : null;
  // Hers to withdraw, or theirs to answer — the owner flips with every
  // counter, and the card names which side is waiting rather than showing her
  // a Withdraw button for a round she did not write (§7.5).
  const openProposalIsHers = openProposal?.proposed_by === carerId;
  const carerName = arrangement?.carer_display_name;
  // D-41: 'seen' NEVER renders as agreement. See this module's header.
  const ackStateWord =
    ackState.kind === 'disagreed'
      ? t('ack.disagreed', { date: ackDate })
      : ackState.kind === 'seen'
        ? carerName
          ? t('ack.seenBy', { name: carerName, date: ackDate })
          : t('ack.seen', { date: ackDate })
        : t('ack.notSeenYet');
  // The prompt is offered until she has recorded that she saw THIS version.
  // A recorded disagreement is not a substitute — she may want both rows.
  const showAckPrompt = arrangement != null && ackState.kind !== 'seen';
  const ackError = ackTerms.isError || dissentTerms.isError;

  return (
    <Card testID={`my-pay-household-${household.id}`}>
      <CardContent className="gap-3">
        <Body weight="medium">{household.name}</Body>
        {current.isPending ? (
          <LoadingIndicator testID="my-pay-loading" />
        ) : !arrangement ? (
          <View testID={`my-pay-empty-${household.id}`}>
            <EmptyState
              variant="inline"
              image={illustrations.emptyHours}
              title={t('myPay.emptyTitle')}
              description={t('myPay.emptyDescription')}
            />
          </View>
        ) : (
          <>
            {showAckPrompt ? (
              <View
                testID={`my-pay-ack-prompt-${household.id}`}
                className="gap-3 rounded-row bg-secondary px-4 py-3"
              >
                <Body weight="medium">
                  {previous
                    ? t('ack.changedTitle', {
                        date: formatDisplayDateWithYear(arrangement.valid_from),
                      })
                    : t('ack.firstTitle')}
                </Body>
                <Small className="text-muted-foreground">
                  {previous
                    ? summarizeTermsDiff(
                        buildTermsDiff(previous, arrangement, t)
                      )
                    : t('history.firstTermsSet')}
                </Small>
                <LoadingButton
                  testID={`my-pay-ack-seen-${household.id}`}
                  label={t('ack.seenButton')}
                  isLoading={ackTerms.isPending}
                  onPress={() => ackTerms.mutate(arrangement.id)}
                />
                <Button
                  testID={`my-pay-ack-disagree-${household.id}`}
                  variant="ghost"
                  onPress={() => setDissentOpen(true)}
                >
                  <Text>{t('ack.disagreeButton')}</Text>
                </Button>
                {/* Load-bearing, and must not soften into reassurance-speak
                 * (§8.3.1): the button above is a receipt, not a waiver. */}
                <Small className="text-muted-foreground">
                  {t('ack.reassurance')}
                </Small>
                {ackError ? (
                  <InlineError
                    testID={`my-pay-ack-error-${household.id}`}
                    message={t('ack.recordFailed')}
                  />
                ) : null}
              </View>
            ) : null}
            <View className="flex-row items-baseline gap-1">
              <H1 tabular>
                {formatMoney(arrangement.rate_minor, arrangement.currency)}
              </H1>
              <Body className="text-muted-foreground">/hr</Body>
            </View>
            <TermsDocumentRows
              arrangement={arrangement}
              balance={balance.data}
              testIDPrefix={`my-pay-term-${household.id}`}
            />
            <Small className="text-muted-foreground">
              {t('inEffectSince', {
                date: formatDisplayDateWithYear(arrangement.valid_from),
              })}
            </Small>
            <Small
              testID={`my-pay-ack-state-${household.id}`}
              className="text-muted-foreground"
            >
              {ackStateWord}
            </Small>
            <Button
              testID={`my-pay-history-toggle-${household.id}`}
              variant="ghost"
              onPress={() => setHistoryOpen(open => !open)}
            >
              <Text>{t('myPay.historyButton')}</Text>
            </Button>
            {openProposal && openProposalState ? (
              <>
                <StatusPill
                  testID={`my-pay-proposal-pill-${household.id}`}
                  variant={openProposalState.variant}
                  label={openProposalState.label}
                />
                {openProposalIsHers ? (
                  <Button
                    testID={`my-pay-proposal-withdraw-${household.id}`}
                    variant="ghost"
                    onPress={() => withdrawTerms.mutate()}
                  >
                    <Text className="text-destructive">
                      {t('proposal.withdrawButton')}
                    </Text>
                  </Button>
                ) : (
                  <Button
                    testID={`my-pay-proposal-review-${household.id}`}
                    variant="ghost"
                    onPress={() =>
                      router.push(`/pay/proposal/${openProposal.id}`)
                    }
                  >
                    <Text>{t('proposal.reviewButton')}</Text>
                  </Button>
                )}
              </>
            ) : canWrite ? (
              <Button
                testID={`my-pay-suggest-change-${household.id}`}
                variant="ghost"
                onPress={() => setProposeOpen(true)}
              >
                <Text>{t('proposal.suggestChangeButton')}</Text>
              </Button>
            ) : null}
            {historyOpen ? (
              <View className="gap-2" testID={`my-pay-history-${household.id}`}>
                {/* Withdrawn and countered rounds stay here — nothing in this
                    domain is deleted (§9.1). */}
                {(proposals.data ?? [])
                  .filter(row => row.status !== 'proposed')
                  .map(row => (
                    <View
                      key={row.id}
                      testID={`my-pay-proposal-history-${row.id}`}
                      className="flex-row items-center gap-2"
                    >
                      <StatusPill
                        testID={`my-pay-proposal-history-pill-${row.id}`}
                        variant={
                          proposalStateWord(
                            row,
                            {
                              counterpartyName: householdName,
                              timezone: household.timezone,
                            },
                            t
                          ).variant
                        }
                        label={proposalHistoryLabel(
                          row,
                          {
                            authorName:
                              row.proposed_by === carerId
                                ? t('proposal.you')
                                : householdName,
                            timezone: household.timezone,
                          },
                          t
                        )}
                      />
                    </View>
                  ))}
                {(history.data ?? []).map((row, index) => {
                  // §8.5: what CHANGED, not just the rate. The oldest row has
                  // no predecessor and says so rather than diffing nothing.
                  const older = (history.data ?? [])[index + 1] ?? null;
                  return (
                    <View
                      key={row.id}
                      testID={`my-pay-history-row-${row.id}`}
                      className="gap-1 rounded-row bg-card px-4 py-3"
                      style={elevation.row}
                    >
                      <Body weight="medium">
                        {t('historyFrom', {
                          date: formatDisplayDateWithYear(row.valid_from),
                        })}
                      </Body>
                      <Small
                        testID={`my-pay-history-diff-${row.id}`}
                        className="text-muted-foreground"
                      >
                        {older
                          ? summarizeTermsDiff(buildTermsDiff(older, row, t))
                          : t('history.firstTermsSet')}
                      </Small>
                      {row.id === arrangement.id && ackState.kind === 'seen' ? (
                        <Small
                          testID={`my-pay-history-seen-${row.id}`}
                          className="text-muted-foreground"
                        >
                          {t('ack.historySeen', { date: ackDate })}
                        </Small>
                      ) : null}
                      {row.note ? (
                        <Small className="text-muted-foreground">
                          {row.note}
                        </Small>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
            {/* 3-U1's form, pre-filled from the CURRENT arrangement. A nanny
                who joined a parent-first household in 2024 and wants a raise
                in 2026 uses identical machinery to a nanny-first onboarding —
                which is the point of there being one form. */}
            <PayChangeSheet
              mode="propose"
              counterpartyName={householdName}
              visible={proposeOpen}
              onDismiss={() => setProposeOpen(false)}
              onSubmit={terms => {
                proposeTerms
                  .mutateAsync({ terms })
                  .then(() => setProposeOpen(false))
                  .catch(() => undefined);
              }}
              isSubmitting={proposeTerms.isPending}
              currentArrangement={arrangement}
              householdCancellationDefaultHours={
                household.cancellation_paid_within_hours ?? 0
              }
              householdTimezone={household.timezone}
              householdWeekStartsOn={household.week_starts_on ?? 1}
              todayISO={localDateInZone(household.timezone)}
            />
            <DissentSheet
              householdId={household.id}
              visible={dissentOpen}
              onDismiss={() => setDissentOpen(false)}
              isSubmitting={dissentTerms.isPending}
              onSubmit={note => {
                dissentTerms
                  .mutateAsync({ arrangementId: arrangement.id, note })
                  .then(() => setDissentOpen(false))
                  // Failure stays inline on the card behind the sheet; the
                  // sheet keeps her typed note rather than losing it.
                  .catch(() => undefined);
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MyPayScreen() {
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const households = useHouseholds();
  // Households she was REMOVED from belong here too: the pay she is still
  // owed by a family she left is exactly what this screen exists to show —
  // read-only, because §9.1's "Suggest a change" is a write and a past member
  // has nothing to renegotiate.
  const pastHouseholds = usePastHouseholds();
  const payableHouseholds = [
    ...(households.data ?? []).map(household => ({
      household,
      canWrite: true,
    })),
    ...(pastHouseholds.data ?? []).map(household => ({
      household,
      canWrite: false,
    })),
  ];
  const userId = useAuthStore(s => s.user?.id ?? null);

  // A back affordance in EVERY state, including the transient loading one —
  // this screen is reachable straight from settings with no other way out
  // while it's still resolving (review finding 5).
  if (onboarding.status === 'loading') {
    return (
      <View testID="my-pay-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackRow
            testID="my-pay-loading-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <LoadingIndicator testID="my-pay-loading" />
      </View>
    );
  }

  if (onboarding.role !== SETUP_ROLES.NANNY) {
    return (
      <View testID="my-pay-not-available" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackRow
            testID="my-pay-not-available-back"
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
            title={t('myPay.notAvailableTitle')}
            description={t('myPay.notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      testID="my-pay-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <BackRow
        testID="my-pay-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1 className="mt-1">{t('myPay.title')}</H1>
      <Small className="mt-1 text-muted-foreground">
        {t('myPay.subtitle')}
      </Small>

      {households.isPending ? (
        <LoadingIndicator testID="my-pay-loading" />
      ) : households.isError ? (
        <ErrorState variant="network" onRetry={() => households.refetch()} />
      ) : !userId ? null : (
        <View className="mt-4 gap-3">
          {payableHouseholds.map(({ household, canWrite }) => (
            <MyPayHouseholdCard
              key={household.id}
              household={household}
              carerId={userId}
              canWrite={canWrite && !onboarding.isPastMember}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
