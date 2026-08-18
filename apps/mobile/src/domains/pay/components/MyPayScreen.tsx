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
 * D-31/D-41 (`docs/design/screens-pay-terms.md` §8.2/§8.3): the READ RECEIPT
 * records the date she saw a version and nothing more. Every string here says
 * so — "Read by {name} on {date}", never a word implying she agreed.
 *
 * 1.7: it is now recorded AUTOMATICALLY on first render with data, the same
 * rule `terms_proposals.viewed_at` uses. The button it replaces "looked
 * exactly like an 'I agree' button" and then said in fine print that it was
 * not one, and the reassurance line under it existed solely to defuse that.
 * On a pay screen an ambiguity between a receipt and consent is the one
 * ambiguity that may not exist — and acceptance (§7.3) now records the far
 * stronger fact, so nothing is lost by removing the weaker one.
 *
 * What survives the removal: the read date, the seen state word, the
 * disagreement line — and "I haven't agreed to these", which now appears ONLY
 * on a grandfathered row nobody agreed. The ack still gates NOTHING.
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
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
import {
  isRemindTooSoon,
  useRemindTerms,
} from '@/src/hooks/mutations/useRemindTerms';
import { useWithdrawTerms } from '@/src/hooks/mutations/useWithdrawTerms';
import { onboardingAsQuery, queryState } from '@/src/hooks/queries/queryState';
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
import { proposalReviewHref } from '@/src/lib/notificationRouteMap';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';
import { hasSeenAck, resolveAckState, seenAckAt } from '../utils/ackState';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import {
  proposalHistoryLabel,
  proposalStateWord,
} from '../utils/proposalTerms';
import { resolveTermsAgreement } from '../utils/termsAgreement';
import { buildTermsDiff, summarizeTermsDiff } from '../utils/termsDiff';
import { BackRow } from './BackRow';
import { PayChangeSheet } from './PayChangeSheet';
import { ScheduledChangeCard } from './ScheduledChangeCard';
import { TermsDocumentRows } from './TermsDocumentRows';
import { TermsSentReceipt } from './TermsSentReceipt';

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
  isError,
}: {
  householdId: string;
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (note: string | undefined) => void;
  isSubmitting: boolean;
  isError: boolean;
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
        {/* GOLDEN #40: a failure inside a sheet stays inside the sheet — an
            error on the card behind the open sheet is a message nobody reads. */}
        {isError ? (
          <InlineError
            testID={`my-pay-dissent-error-${householdId}`}
            message={t('ack.recordFailed')}
          />
        ) : null}
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
  const todayISO = localDateInZone(household.timezone);
  const currentYear = Number(todayISO.slice(0, 4));
  const hasEntitlement = current.data?.pto_entitlement_minutes_per_year != null;
  const balance = usePtoBalance(
    household.id,
    carerId,
    hasEntitlement ? currentYear : undefined
  );

  const arrangement = current.data;
  // F18 — the same `valid_from > today` derivation `PayArrangementScreen`
  // uses for its own `scheduled` card, read-only here (no `canManage`).
  const scheduled: PayArrangement | undefined = (history.data ?? [])
    .filter(row => row.valid_from > todayISO)
    .at(-1);
  const ackState = resolveAckState(acks.data);
  const _previous = arrangement
    ? previousVersion(history.data, arrangement.id)
    : null;
  // Household-local, because the date she saw her terms is a date in HER
  // working week, not in whatever zone the device happens to sit in.
  const cardDate = (createdAt: string) =>
    formatDisplayDateWithYear(
      localDateInZone(household.timezone, new Date(createdAt))
    );
  // The two dates are independent facts and are read independently: a
  // disagreement must never swallow the date she read them (§8.4 outranks
  // the WORD, not the row).
  const seenAt = seenAckAt(acks.data);
  const seenDate = seenAt ? cardDate(seenAt) : null;
  const disagreedDate =
    ackState.kind === 'disagreed' ? cardDate(ackState.createdAt) : null;
  // Exactly one proposal can be open at a time; everything else is history —
  // one read, not a `current` and a `history` that can disagree.
  const openProposal = (proposals.data ?? []).find(
    row => row.status === 'proposed'
  );
  // Unconditional, like every hook: an empty id simply has nothing to
  // withdraw, and the button that would call it is not on screen.
  const withdrawTerms = useWithdrawTerms(openProposal?.id ?? '');
  // WP-G — the author's nudge. Same empty-id-is-inert shape as the
  // withdraw hook above, for the same reason: hooks cannot be conditional.
  const remindTerms = useRemindTerms(openProposal?.id ?? '');
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
  // The ONE resolver for "open her proposal by id" — shared with the push
  // notification that lands on the same screen (`notificationRouteMap.ts`),
  // so a tap and a push can never disagree about the destination.
  const goToOpenProposal = () => {
    if (!openProposal) return;
    const href = proposalReviewHref({ proposalId: openProposal.id });
    if (href) router.push(href as Href);
  };
  const carerName = arrangement?.carer_display_name;
  // D-41: 'seen' NEVER renders as agreement. See this module's header.
  // It also never reads "Not read yet" once a 'seen' row exists — a
  // disagreement gets its OWN line below rather than erasing the read date.
  const ackStateWord = seenDate
    ? carerName
      ? t('ack.seenBy', { name: carerName, date: seenDate })
      : t('ack.seen', { date: seenDate })
    : t('ack.notSeenYet');
  /**
   * 1.7 — RECORDED, NOT ASKED FOR. The fact is "she saw this version", and
   * the app knows it the moment this card renders with data: exactly the
   * rule `terms_proposals.viewed_at` already uses. The button it replaces
   * "looked exactly like an 'I agree' button" and then told her in fine
   * print that it was not one — on a pay screen that is the one ambiguity
   * that must not exist. Acceptance now records the far stronger fact, so
   * removing the button removes no evidence.
   *
   * Gated on the ROW, not on the state word (see `ackState`'s header): a
   * disagreement OUTRANKS a seen, so `resolveAckState(...).kind === 'seen'`
   * would hide her seen row forever and re-record on every render. The ref
   * is the in-flight guard — `useAckPayArrangement` writes the row into the
   * cache optimistically, but not before the next render.
   */
  const recordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!arrangement || !acks.isSuccess || hasSeenAck(acks.data)) return;
    if (recordedRef.current === arrangement.id) return;
    recordedRef.current = arrangement.id;
    ackTerms.mutate(arrangement.id);
  }, [arrangement, acks.isSuccess, acks.data, ackTerms.mutate]);

  // 1.3: ONE state line, in ONE slot, for both roles (T16). The parent's
  // copy of this sentence sits in the same place on `PayArrangementScreen`,
  // resolved by the same util — the whole value of these two screens is that
  // neither party can be shown a different contract from the other.
  const agreement = arrangement
    ? resolveTermsAgreement(arrangement, proposals.data, history.data, t)
    : null;
  // docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B:
  // a pending read must not compute an agreement fact either.
  const termsStateLabel =
    proposals.isPending || !arrangement || agreement === null
      ? null
      : agreement.kind === 'agreed'
        ? proposalStateWord(
            agreement.proposal,
            { counterpartyName: householdName, timezone: household.timezone },
            t
          ).label
        : t('notAgreedSetBy', {
            name: householdName,
            date: cardDate(arrangement.created_at),
          });
  const ackError = ackTerms.isError || dissentTerms.isError;
  // False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): `termsStateLabel`
  // and `ackStateWord` above are computed off `proposals`/`history`/`acks`
  // (and `balance`, when there's an entitlement to net against) WITHOUT
  // checking whether those reads actually succeeded — a failed read must
  // never be allowed to compute an agreement/ack fact ("not agreed in
  // Steadily", "Not read yet") the app cannot stand behind.
  const sideDataUnknown =
    proposals.isError ||
    history.isError ||
    acks.isError ||
    (hasEntitlement && balance.isError);
  const retrySideData = () => {
    void proposals.refetch?.();
    void history.refetch();
    void acks.refetch();
    if (hasEntitlement) void balance.refetch();
  };

  return (
    <Card testID={`my-pay-household-${household.id}`}>
      <CardContent className="gap-3">
        <Body weight="medium">{household.name}</Body>
        {current.isPending ? (
          <LoadingIndicator testID="my-pay-loading" />
        ) : current.isError ? (
          <View testID={`my-pay-error-${household.id}`}>
            <ErrorState variant="network" onRetry={() => current.refetch()} />
          </View>
        ) : (
          <>
            {/* F16 — hoisted above the arrangement ternary (the same B2
                pattern `PayArrangementScreen` already uses): an open
                negotiation, or the "Suggest a change" write, must be visible
                even when there are no terms yet — not stranded inside the
                arrangement-only branch where a nanny with a live first offer
                could never see it. */}
            {openProposal && openProposalIsHers ? (
              // 1.2: the receipt, not a pill. It says what she sent, that
              // they have to agree before her clock opens, and whether they
              // have opened it — persistent, so it is still there on Friday.
              <TermsSentReceipt
                testID={`my-pay-terms-receipt-${household.id}`}
                proposal={openProposal}
                counterpartyName={householdName}
                householdTimezone={household.timezone}
                viewer="carer"
                onWithdraw={() => withdrawTerms.mutate()}
                isWithdrawing={withdrawTerms.isPending}
                onRemind={() => remindTerms.mutate()}
                remindedAt={remindTerms.data?.reminded_at ?? null}
                remindTooSoon={isRemindTooSoon(remindTerms.error)}
              />
            ) : openProposal && openProposalState ? (
              <>
                <StatusPill
                  testID={`my-pay-proposal-pill-${household.id}`}
                  variant={openProposalState.variant}
                  label={openProposalState.label}
                />
                <Button
                  testID={`my-pay-proposal-review-${household.id}`}
                  variant="ghost"
                  onPress={goToOpenProposal}
                >
                  <Text>{t('proposal.reviewButton')}</Text>
                </Button>
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

            {!arrangement ? (
              // An open round already rendered its own receipt/pill above —
              // the bare empty state is only for "nothing to see at all".
              openProposal ? null : (
                <View testID={`my-pay-empty-${household.id}`}>
                  <EmptyState
                    variant="inline"
                    image={illustrations.emptyHours}
                    title={t('myPay.emptyTitle')}
                    description={t('myPay.emptyDescription')}
                  />
                </View>
              )
            ) : (
              <>
                {sideDataUnknown ? null : termsStateLabel ? (
                  <Small
                    testID={`my-pay-terms-state-${household.id}`}
                    className="text-muted-foreground"
                  >
                    {termsStateLabel}
                  </Small>
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
                {/* F18 — read-only: no `onEdit`/`onCancel`, `canManage={false}`.
                    A nanny sees the raise coming; only the parent who owns the
                    arrangement can edit or call it off. */}
                {scheduled ? (
                  <ScheduledChangeCard
                    arrangement={scheduled}
                    currentArrangement={arrangement}
                    canManage={false}
                  />
                ) : null}
                {sideDataUnknown ? (
                  // False alarm: no ack pill, no "not agreed in Steadily", no
                  // dissent button — a failed proposals/history/acks/balance
                  // read must never compute a fact about the agreement.
                  <InlineRetry
                    testID={`my-pay-side-data-retry-${household.id}`}
                    message={t('sideDataUnknown')}
                    onRetry={retrySideData}
                  />
                ) : (
                  <>
                    <Small
                      testID={`my-pay-ack-state-${household.id}`}
                      className="text-muted-foreground"
                    >
                      {ackStateWord}
                    </Small>
                    {/* Its own line, never a replacement for the one above:
                        both are true at once, and hiding either is the
                        contradiction a nanny read as the app losing her tap. */}
                    {disagreedDate ? (
                      <Small
                        testID={`my-pay-ack-disagreed-${household.id}`}
                        className="text-muted-foreground"
                      >
                        {t('ack.needsUpdatingLine', { date: disagreedDate })}
                      </Small>
                    ) : null}
                    {dissentTerms.isSuccess ? (
                      <Small
                        testID={`my-pay-dissent-recorded-${household.id}`}
                        className="text-muted-strong"
                      >
                        {t('dissent.recordedNow')}
                      </Small>
                    ) : null}
                    {/* Survives ONLY on a grandfathered row. On terms she
                        agreed it would contradict the line at the top of this
                        card, and "I haven't agreed to these" would be false
                        on its face. */}
                    {agreement?.kind === 'notAgreedInSteadily' ? (
                      <Button
                        testID={`my-pay-ack-disagree-${household.id}`}
                        variant="ghost"
                        className="self-start px-0"
                        onPress={() => setDissentOpen(true)}
                      >
                        <Text>{t('ack.needsUpdatingButton')}</Text>
                      </Button>
                    ) : null}
                    {ackError ? (
                      <InlineError
                        testID={`my-pay-ack-error-${household.id}`}
                        message={t('ack.recordFailed')}
                      />
                    ) : null}
                  </>
                )}
                <Button
                  testID={`my-pay-history-toggle-${household.id}`}
                  variant="ghost"
                  onPress={() => setHistoryOpen(open => !open)}
                >
                  <Text>{t('myPay.historyButton')}</Text>
                </Button>
                {historyOpen ? (
                  <View
                    className="gap-2"
                    testID={`my-pay-history-${household.id}`}
                  >
                    {/* Withdrawn and countered rounds stay here — nothing in
                        this domain is deleted (§9.1). */}
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
                      // §8.5: what CHANGED, not just the rate. The oldest row
                      // has no predecessor and says so rather than diffing
                      // nothing.
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
                              ? summarizeTermsDiff(
                                  buildTermsDiff(older, row, t)
                                )
                              : t('history.firstTermsSet')}
                          </Small>
                          {row.id === arrangement.id && seenDate ? (
                            <Small
                              testID={`my-pay-history-seen-${row.id}`}
                              className="text-muted-foreground"
                            >
                              {t('ack.historySeen', { date: seenDate })}
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
                <DissentSheet
                  householdId={household.id}
                  visible={dissentOpen}
                  onDismiss={() => setDissentOpen(false)}
                  isSubmitting={dissentTerms.isPending}
                  isError={dissentTerms.isError}
                  onSubmit={note => {
                    dissentTerms
                      .mutateAsync({ arrangementId: arrangement.id, note })
                      .then(() => setDissentOpen(false))
                      // Failure renders inline INSIDE the sheet (GOLDEN #40);
                      // the sheet keeps her typed note rather than losing it.
                      .catch(() => undefined);
                  }}
                />
              </>
            )}
            {/* 3-U1's form, pre-filled from the CURRENT arrangement (or blank
                when there is none yet — F16 makes "Suggest a change" reachable
                with no arrangement too, so this sheet must be reachable
                unconditionally, not nested inside the arrangement-only
                branch). A nanny who joined a parent-first household in 2024
                and wants a raise in 2026 uses identical machinery to a
                nanny-first onboarding — which is the point of there being one
                form. */}
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
              submitError={
                proposeTerms.isError ? t('proposal.sendFailed') : null
              }
              currentArrangement={arrangement ?? undefined}
              householdCancellationDefaultHours={
                household.cancellation_paid_within_hours ?? 0
              }
              householdTimezone={household.timezone}
              householdWeekStartsOn={household.week_starts_on ?? 1}
              todayISO={localDateInZone(household.timezone)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MyPayScreen() {
  const { refreshControl } = usePullToRefresh();
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
  //
  // C6 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): `onboarding.status`
  // stays `'loading'` FOREVER on a failed memberships read — checking that
  // alone made this a permanent spinner with no reachable retry.
  // `onboardingAsQuery` + `queryState` is what lets error win over loading.
  const onboardingQs = queryState(onboardingAsQuery(onboarding));
  if (onboardingQs.status === 'error') {
    return (
      <View testID="my-pay-screen" className="flex-1 bg-background">
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackRow
            testID="my-pay-error-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <View testID="my-pay-membership-error">
          <ErrorState variant="network" onRetry={onboardingQs.retry} />
        </View>
      </View>
    );
  }

  if (onboardingQs.status === 'loading') {
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
      refreshControl={refreshControl}
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
