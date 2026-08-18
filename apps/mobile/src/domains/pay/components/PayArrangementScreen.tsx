/**
 * @module domains/pay/components/PayArrangementScreen
 *
 * Surface A — "Pay & terms" (TIER0-CX-SPEC.md §2), parent-only. Serves both
 * routes: `/settings/pay` (no carer id — resolves from the household's
 * nanny members) and `/settings/pay/[carerId]` (the explicit second-nanny
 * case). One component for both, reading `carerId` from the route itself,
 * because the branching the spec describes ("one carer -> inline, two or
 * more -> a picker") only makes sense evaluated in one place.
 *
 * The append-only note lives in `Small` muted copy directly above the
 * History heading. D-16 re-opened future-dated terms, so §6's scheduled-
 * change card is back: a `valid_from` after the household's today is a
 * promise that has not landed yet, and the parent needs both a way to see it
 * and a way to call it off (which is itself an APPEND, never a delete).
 *
 * §8.4: the ack pill beside "In effect since" reports whether the carer has
 * SEEN this version. A disagreement outranks a seen. The pill never uses the
 * word 3-O's proposal flow owns — see `../utils/ackState`.
 */

import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { AnimatedPressable } from '@/lib/animations';
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
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { DEFAULT_WEEK_STARTS_ON } from '@/src/domains/timesheet/utils/week';
import { useCancelScheduledPayArrangement } from '@/src/hooks/mutations/useCancelScheduledPayArrangement';
import { useProposeTerms } from '@/src/hooks/mutations/useProposeTerms';
import { useWithdrawTerms } from '@/src/hooks/mutations/useWithdrawTerms';
import { onboardingAsQuery, queryState } from '@/src/hooks/queries/queryState';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { usePayArrangementAcks } from '@/src/hooks/queries/usePayArrangementAcks';
import { usePayArrangementHistory } from '@/src/hooks/queries/usePayArrangementHistory';
import { usePtoBalance } from '@/src/hooks/queries/usePtoBalance';
import {
  findOpenTermsProposal,
  useTermsProposals,
} from '@/src/hooks/queries/useTermsProposals';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney, formatRate } from '@/src/lib/money';
import { proposalReviewHref } from '@/src/lib/notificationRouteMap';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';
import { resolveAckState, seenAckAt } from '../utils/ackState';
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

function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function CarerPickerRow({
  householdId,
  carer,
  roleFallbackLabel,
  onPress,
}: {
  householdId: string;
  carer: HouseholdMember;
  roleFallbackLabel: string;
  onPress: () => void;
}) {
  const elevation = useElevation();
  const current = useCurrentPayArrangement(householdId, carer.user_id);
  const { t } = useTranslation('pay');
  const name = resolveCarerName(
    carer,
    roleFallbackLabel,
    current.data?.carer_display_name
  );

  return (
    <AnimatedPressable
      testID={`pay-carer-picker-${carer.user_id}`}
      accessibilityRole="button"
      accessibilityLabel={name}
      hitSlop={8}
      onPress={onPress}
    >
      <View
        className="flex-row items-center justify-between gap-3 rounded-row bg-card px-4 py-3"
        style={elevation.row}
      >
        <Body className="flex-1 text-primary">{name}</Body>
        {/* While the rate query is pending, render nothing rather than a
         * misleading "Not set" (review finding 7) — the PaySetupPromptCard's
         * isPending -> null discipline, applied to this rate label too. */}
        {current.isPending ? null : (
          <Small className="text-muted-foreground" tabular>
            {current.data
              ? formatRate(current.data.rate_minor, current.data.currency)
              : t('notSet')}
          </Small>
        )}
      </View>
    </AnimatedPressable>
  );
}

interface CarerPayDetailProps {
  householdId: string;
  householdTimezone: string;
  /** `households.week_starts_on` — the household's business week, which
   * decides whether an effective date splits a week (`PayChangeSheet`). */
  householdWeekStartsOn: number;
  householdCancellationDefaultHours: number;
  carerId: string;
  /** The carer's own household-membership row, when resolved — the first
   * link in the display-name fallback chain (review finding 8). */
  carerMember: HouseholdMember | undefined;
  /** The role label to fall back to when neither the member's own override
   * nor the arrangement's stored name are available. */
  roleFallbackLabel: string;
  /** Only true when reached via the 2+ nanny picker — a single-nanny
   * household infers the carer from context, so repeating her name would be
   * redundant noise on an already-titled screen. */
  showCarerName: boolean;
  members: HouseholdMember[];
}

function CarerPayDetail({
  householdId,
  householdTimezone,
  householdWeekStartsOn,
  householdCancellationDefaultHours,
  carerId,
  carerMember,
  roleFallbackLabel,
  showCarerName,
  members,
}: CarerPayDetailProps) {
  const { t } = useTranslation('pay');
  const router = useRouter();
  const current = useCurrentPayArrangement(householdId, carerId);
  const history = usePayArrangementHistory(householdId, carerId);
  const acks = usePayArrangementAcks(householdId, carerId, current.data?.id);
  const proposeTerms = useProposeTerms(householdId, carerId);
  const cancelScheduled = useCancelScheduledPayArrangement(
    householdId,
    carerId
  );
  const me = useAuthStore(s => s.session?.user?.id ?? null);
  // §7.1: Settings → Pay carries a row with a `pending` "Proposed" pill for as
  // long as one is open. Nothing announces their absence — the screen is
  // unchanged when there is no proposal (§12).
  const proposals = useTermsProposals(householdId, carerId);
  // §7.1 / B2: the live negotiation, if any — same predicate as
  // PaySetupPromptCard via `findOpenTermsProposal`. Read BEFORE the early
  // returns below, because `useWithdrawTerms` is a hook and an empty id
  // simply has nothing to withdraw.
  const openProposal = findOpenTermsProposal(proposals.data);
  const withdrawTerms = useWithdrawTerms(openProposal?.id ?? '');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const elevation = useElevation();

  // Household-local "today"'s year — called unconditionally (rules of
  // hooks), BEFORE `current` is known to have settled. `hasEntitlement`
  // reads `current.data` directly (not the later `arrangement` const, which
  // doesn't exist yet at this point in the render) so the balance query
  // only turns on once there is an entitlement to compute against
  // (TIER0-CX-SPEC.md §5.2: "no entitlement -> no balance is computed").
  const todayISO = localDateInZone(householdTimezone);
  const currentYear = Number(todayISO.slice(0, 4));
  const hasEntitlement = current.data?.pto_entitlement_minutes_per_year != null;
  const balance = usePtoBalance(
    householdId,
    carerId,
    hasEntitlement ? currentYear : undefined
  );

  // F15 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): `acks` feeds the ack
  // pill and `balance` feeds the PTO row below — a failed read on either
  // used to render the detail anyway, computing that pill / row off data
  // that never arrived. Both `acks` and `balance` gate on `hasArrangement`/
  // `hasEntitlement` before being checked — each is `enabled: false` (and
  // therefore `isPending` FOREVER, per TanStack Query v5) until there's an
  // arrangement/entitlement to ask about, and including either unconditionally
  // would pin the "no arrangement yet" empty state on a spinner forever.
  const hasArrangement = !!current.data;
  if (
    current.isPending ||
    history.isPending ||
    (hasArrangement && acks.isPending) ||
    (hasEntitlement && balance.isPending)
  ) {
    return <LoadingIndicator testID="pay-loading" />;
  }
  if (
    current.isError ||
    history.isError ||
    (hasArrangement && acks.isError) ||
    (hasEntitlement && balance.isError)
  ) {
    return (
      <ErrorState
        variant="network"
        onRetry={() => {
          void current.refetch();
          void history.refetch();
          if (hasArrangement) void acks.refetch();
          if (hasEntitlement) void balance.refetch();
        }}
      />
    );
  }

  const arrangement = current.data;
  // Resolved only once `current` has settled — the arrangement's stored
  // `carer_display_name` is the second link in the fallback chain (review
  // finding 8), and it isn't known any earlier than this.
  const carerName = resolveCarerName(
    carerMember,
    roleFallbackLabel,
    arrangement?.carer_display_name
  );

  const ackState = resolveAckState(acks.data);
  const ackDate =
    ackState.kind === 'none'
      ? null
      : formatDisplayDateWithYear(
          localDateInZone(householdTimezone, new Date(ackState.createdAt))
        );
  // §8.4's three states, in the order the spec ranks them: a disagreement
  // outranks a seen, because that is the one the reader would be misled by
  // not seeing. Never worded as agreement (D-41).
  const ackPill =
    ackState.kind === 'disagreed'
      ? ({
          variant: 'declined',
          label: t('ack.disagreed', { date: ackDate }),
        } as const)
      : ackState.kind === 'seen'
        ? ({
            variant: 'confirmed',
            label: t('ack.seen', { date: ackDate }),
          } as const)
        : ({ variant: 'pending', label: t('ack.notSeenYet') } as const);
  // F21 (`ackState.ts`'s own header): seeing something and disagreeing with
  // it are different facts, and the history row must show BOTH independently
  // — gating it on `ackState.kind === 'seen'` is the bug that stranded a real
  // nanny, since a later disagreement outranks 'seen' for the WORD but must
  // never erase the date she read it. `seenAckAt` is the ungated read;
  // `MyPayScreen` already uses it for the same reason.
  const seenAt = seenAckAt(acks.data);
  const seenDate = seenAt
    ? formatDisplayDateWithYear(
        localDateInZone(householdTimezone, new Date(seenAt))
      )
    : null;

  // 1.3: ONE state line, in ONE slot, for both roles (T16). Either these
  // terms were agreed — and the word comes with the date and the name, from
  // the round that agreed them — or they were merely set, and the line says
  // so rather than letting silence imply agreement. Grandfathered rows stay
  // in force; only the description changes.
  const agreement = arrangement
    ? resolveTermsAgreement(arrangement, proposals.data, history.data, t)
    : null;
  const setByMember = arrangement?.created_by
    ? members.find(m => m.user_id === arrangement.created_by)
    : undefined;
  const setByName =
    arrangement?.created_by && arrangement.created_by === me
      ? t('proposal.you')
      : resolveCarerName(setByMember, t('proposal.theFamily'));
  // docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B:
  // a pending read must not compute an agreement fact either.
  const termsStateLabel =
    proposals.isPending || agreement === null
      ? null
      : agreement.kind === 'agreed'
        ? proposalStateWord(
            agreement.proposal,
            { counterpartyName: carerName, timezone: householdTimezone },
            t
          ).label
        : t('notAgreedSetBy', {
            name: setByName,
            date: arrangement
              ? formatDisplayDateWithYear(
                  localDateInZone(
                    householdTimezone,
                    new Date(arrangement.created_at)
                  )
                )
              : '',
          });

  const scheduled: PayArrangement | undefined = (history.data ?? [])
    .filter(row => row.valid_from > todayISO)
    .at(-1);

  /**
   * P1: this SENDS A ROUND, it does not write terms. The success state is
   * not a toast — it is `TermsSentReceipt` above, rendered off the open
   * proposal, which is still there tomorrow.
   *
   * `supersedes_id` is not optional politeness: 092's partial unique index
   * allows one `proposed` row per (household, carer), so proposing over an
   * open round raises a raw 23505. The real path is her proposing from the
   * blocked card and the parent then opening this screen and tapping Send.
   */
  const handleSubmit = (input: CreatePayArrangementRequest) => {
    proposeTerms
      .mutateAsync({
        terms: input,
        ...(openProposal ? { supersedes_id: openProposal.id } : {}),
      })
      .then(() => setSheetOpen(false))
      // Failure renders inline INSIDE the sheet (GOLDEN #40), which stays
      // open with the typed values (ClockOutSheet discipline).
      .catch(() => undefined);
  };

  /** The ONE resolver for "open her proposal by id" — shared with the push
   * notification that lands on the same screen (`notificationRouteMap.ts`),
   * so a tap and a push can never disagree about the destination. */
  const goToOpenProposal = () => {
    if (!openProposal) return;
    const href = proposalReviewHref({ proposalId: openProposal.id });
    if (href) router.push(href as Href);
  };

  return (
    <View className="mt-4 gap-4" testID={`pay-detail-${carerId}`}>
      {showCarerName ? <H4 testID="pay-carer-name">{carerName}</H4> : null}
      {/* B2: hoist above the arrangement ternary so an open negotiation is
          visible even when there are no terms yet (empty state used to hide
          this row and invite writing an arrangement over it). */}
      {openProposal && openProposal.direction === 'parent' ? (
        <TermsSentReceipt
          proposal={openProposal}
          counterpartyName={carerName}
          householdTimezone={householdTimezone}
          viewer="parent"
          onWithdraw={() => withdrawTerms.mutate()}
          isWithdrawing={withdrawTerms.isPending}
        />
      ) : null}
      {openProposal && openProposal.direction !== 'parent' ? (
        <View
          testID="pay-open-proposal-row"
          className="gap-2 rounded-row bg-card px-4 py-3"
          style={elevation.row}
        >
          {/* Only a round SHE authored reaches here — a round the parent
              sent renders the receipt above instead, which says strictly
              more than a title could. */}
          <Body testID="pay-open-proposal-title" weight="medium">
            {t('proposal.openRowTitleReceived', { name: carerName })}
          </Body>
          <StatusPill
            testID="pay-open-proposal-pill"
            variant={
              proposalStateWord(
                openProposal,
                {
                  counterpartyName: carerName,
                  timezone: householdTimezone,
                },
                t
              ).variant
            }
            label={
              proposalStateWord(
                openProposal,
                {
                  counterpartyName: carerName,
                  timezone: householdTimezone,
                },
                t
              ).label
            }
          />
          <Button
            testID="pay-open-proposal-review"
            variant="ghost"
            className="self-start"
            onPress={goToOpenProposal}
          >
            <Text>{t('proposal.reviewButton')}</Text>
          </Button>
        </View>
      ) : null}
      {!arrangement ? (
        <View testID="pay-empty-no-arrangement">
          <EmptyState
            variant="inline"
            image={illustrations.emptyPay}
            title={t('noArrangementTitle')}
            description={t('noArrangementDescription')}
            action={() =>
              openProposal
                ? goToOpenProposal()
                : router.push(`/settings/pay/setup/${carerId}` as Href)
            }
            actionLabel={
              openProposal
                ? t('reviewProposedTermsAction')
                : t('setPayTermsAction')
            }
          />
        </View>
      ) : (
        <>
          {scheduled ? (
            <ScheduledChangeCard
              arrangement={scheduled}
              currentArrangement={arrangement}
              canManage
              onEdit={() => setSheetOpen(true)}
              onCancel={() => setCancelConfirmOpen(true)}
              cancelError={
                cancelScheduled.isError
                  ? t('scheduledChange.cancelFailed')
                  : null
              }
            />
          ) : null}

          <Card testID="pay-current-terms-card">
            <CardContent className="gap-3">
              {termsStateLabel ? (
                <Small
                  testID="pay-terms-state"
                  className="text-muted-foreground"
                >
                  {termsStateLabel}
                </Small>
              ) : null}
              <View className="flex-row flex-wrap items-center gap-2">
                <Small className="text-muted-foreground">
                  {t('inEffectSince', {
                    date: formatDisplayDateWithYear(arrangement.valid_from),
                  })}
                </Small>
                <StatusPill
                  testID="pay-ack-pill"
                  variant={ackPill.variant}
                  label={ackPill.label}
                />
              </View>
              <View className="flex-row items-baseline gap-1">
                <H1 testID="pay-current-rate" tabular>
                  {formatMoney(arrangement.rate_minor, arrangement.currency)}
                </H1>
                <Body className="text-muted-foreground">/hr</Body>
              </View>
              <TermsDocumentRows
                arrangement={arrangement}
                balance={balance.data}
                testIDPrefix="pay-term"
              />
              <Button
                testID="pay-change-terms-button"
                onPress={() => setSheetOpen(true)}
              >
                <Text>{t('changeTermsButton')}</Text>
              </Button>
            </CardContent>
          </Card>

          <Small className="text-muted-foreground">{t('appendOnlyNote')}</Small>

          <H4>{t('historyHeading')}</H4>

          {/* F17/F20 — closed negotiation rounds. `proposals` already carries
              every status for this (household, carer) pair (`useTermsProposals`'s
              own doc: "every round … newest first"), so this is the SAME data
              `MyPayScreen` renders as its own history list, filtered and
              authored the same way, just read from the parent's side: "you"
              is whoever `me` is, not whoever the carer is. */}
          {(proposals.data ?? []).some(row => row.status !== 'proposed') ? (
            <View className="gap-2" testID="pay-proposal-history-list">
              {(proposals.data ?? [])
                .filter(row => row.status !== 'proposed')
                .map(row => (
                  <View
                    key={row.id}
                    testID={`pay-proposal-history-${row.id}`}
                    className="flex-row items-center gap-2"
                  >
                    <StatusPill
                      testID={`pay-proposal-history-pill-${row.id}`}
                      variant={
                        proposalStateWord(
                          row,
                          {
                            counterpartyName: carerName,
                            timezone: householdTimezone,
                          },
                          t
                        ).variant
                      }
                      label={proposalHistoryLabel(
                        row,
                        {
                          authorName:
                            row.proposed_by === me
                              ? t('proposal.you')
                              : carerName,
                          timezone: householdTimezone,
                        },
                        t
                      )}
                    />
                  </View>
                ))}
            </View>
          ) : null}

          <View className="gap-2" testID="pay-history-list">
            {history.data?.map((row, index) => {
              const setByMember = row.created_by
                ? members.find(m => m.user_id === row.created_by)
                : undefined;
              // Empty fallback on purpose: an unnamed setter drops to the
              // no-name copy branch below rather than reading "Carer set
              // this rate". The resolver still adds her profile name.
              const setByName = resolveCarerName(setByMember, '');
              // §8.5: what CHANGED, from the same `buildTermsDiff` the change
              // review used. The oldest row has no predecessor and says so
              // rather than diffing against nothing.
              const older = (history.data ?? [])[index + 1] ?? null;
              return (
                <View
                  key={row.id}
                  testID={`pay-history-${row.id}`}
                  className="gap-2 rounded-row bg-card px-4 py-3"
                  style={elevation.row}
                >
                  <Body weight="medium">
                    {t('historyFrom', {
                      date: formatDisplayDateWithYear(row.valid_from),
                    })}
                  </Body>
                  <Small
                    testID={`pay-history-diff-${row.id}`}
                    className="text-muted-foreground"
                  >
                    {older
                      ? summarizeTermsDiff(buildTermsDiff(older, row, t))
                      : t('history.firstTermsSet')}
                  </Small>
                  {row.id === arrangement.id && seenDate ? (
                    <Small
                      testID={`pay-history-seen-${row.id}`}
                      className="text-muted-foreground"
                    >
                      {t('ack.historySeen', { date: seenDate })}
                    </Small>
                  ) : null}
                  <Small className="text-muted-foreground">
                    {setByName
                      ? t('historyFromSetBy', {
                          date: formatDisplayDateWithYear(row.valid_from),
                          name: setByName,
                          createdDate: formatDisplayDateWithYear(
                            localDateInZone(
                              householdTimezone,
                              new Date(row.created_at)
                            )
                          ),
                        })
                      : t('historyFrom', {
                          date: formatDisplayDateWithYear(row.valid_from),
                        })}
                  </Small>
                  {row.note ? (
                    <Small className="text-muted-foreground">{row.note}</Small>
                  ) : null}
                </View>
              );
            })}
          </View>

          <PayChangeSheet
            visible={sheetOpen}
            onDismiss={() => setSheetOpen(false)}
            onSubmit={handleSubmit}
            isSubmitting={proposeTerms.isPending}
            submitError={
              proposeTerms.isError ? t('changeSheet.saveFailed') : null
            }
            counterpartyName={carerName}
            currentArrangement={arrangement}
            householdCancellationDefaultHours={
              householdCancellationDefaultHours
            }
            householdTimezone={householdTimezone}
            householdWeekStartsOn={householdWeekStartsOn}
            todayISO={todayISO}
          />

          {/* §6: cancelling is an APPEND, and the confirm says so — the
              change and its cancellation both stay in the history. */}
          <AlertDialog
            open={cancelConfirmOpen}
            onOpenChange={setCancelConfirmOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('scheduledChange.confirmTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('scheduledChange.confirmBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* Children MUST be wrapped in <Text> — these primitives feed
                    a TextClassContext and a bare string child crashes RN. */}
                <AlertDialogCancel testID="pay-scheduled-cancel-dismiss">
                  <Text>{t('scheduledChange.confirmKeep')}</Text>
                </AlertDialogCancel>
                <AlertDialogAction
                  testID="pay-scheduled-cancel-confirm"
                  onPress={() => {
                    setCancelConfirmOpen(false);
                    if (scheduled) cancelScheduled.mutate(scheduled.id);
                  }}
                >
                  <Text>{t('scheduledChange.confirmCancel')}</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </View>
  );
}

export function PayArrangementScreen() {
  const { refreshControl } = usePullToRefresh();
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const router = useRouter();
  const params = useLocalSearchParams<{ carerId?: string | string[] }>();
  const carerIdParam = normalizeParam(params.carerId);

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const householdId = activeHousehold.householdId;
  const members = useHouseholdMembers(householdId);

  const nannies = useMemo(
    () =>
      (members.data ?? []).filter(
        m => m.role === 'nanny' && m.status === 'active'
      ),
    [members.data]
  );

  // C6 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): `onboarding.status`
  // stays 'loading' FOREVER on a failed memberships read — checking that
  // alone made this a permanent spinner with no reachable retry.
  const onboardingQs = queryState(onboardingAsQuery(onboarding));
  if (onboardingQs.status === 'error') {
    return (
      <View testID="pay-screen" className="flex-1 bg-background">
        <ErrorState variant="network" onRetry={onboardingQs.retry} />
      </View>
    );
  }

  if (onboardingQs.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="pay-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (!isParentEditorRole(onboarding.role) || onboarding.isPastMember) {
    return (
      <View testID="pay-not-available" className="flex-1 bg-background">
        <ScrollView
          contentContainerStyle={SCREEN_CONTENT_STYLE}
          refreshControl={refreshControl}
        >
          <BackRow
            testID="pay-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
          <View className="mt-8">
            <EmptyState
              variant="inline"
              title={t('notAvailableTitle')}
              description={t('notAvailableDescription')}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!householdId || members.isPending) {
    return (
      <View testID="pay-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (members.isError) {
    return <ErrorState variant="network" onRetry={() => members.refetch()} />;
  }

  const resolvedCarerId =
    carerIdParam ??
    (nannies.length === 1 ? (nannies[0]?.user_id ?? null) : null);
  const resolvedCarerMember = resolvedCarerId
    ? nannies.find(m => m.user_id === resolvedCarerId)
    : undefined;
  const household = activeHousehold.household;

  return (
    <ScrollView
      testID="pay-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
      refreshControl={refreshControl}
    >
      <BackRow
        testID="pay-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1 testID="pay-title" className="mt-1">
        {t('title')}
      </H1>
      <Small className="mt-1 text-muted-foreground">{t('subtitle')}</Small>

      {!resolvedCarerId ? (
        nannies.length === 0 ? (
          <View className="mt-4" testID="pay-empty-no-carer">
            <EmptyState
              variant="inline"
              image={illustrations.emptyNoCarer}
              title={t('noCarerTitle')}
              description={t('noCarerDescription')}
              action={() => router.push('/settings/invite')}
              actionLabel={t('inviteAction')}
            />
          </View>
        ) : (
          <View className="mt-4 gap-2" testID="pay-carer-picker">
            {nannies.map(member => (
              <CarerPickerRow
                key={member.id}
                householdId={householdId}
                carer={member}
                roleFallbackLabel={tSettings('role.nanny')}
                onPress={() => router.push(`/settings/pay/${member.user_id}`)}
              />
            ))}
          </View>
        )
      ) : (
        <CarerPayDetail
          householdId={householdId}
          householdTimezone={household?.timezone ?? 'UTC'}
          householdWeekStartsOn={
            household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON
          }
          householdCancellationDefaultHours={
            household?.cancellation_paid_within_hours ?? 0
          }
          carerId={resolvedCarerId}
          carerMember={resolvedCarerMember}
          roleFallbackLabel={tSettings('role.nanny')}
          showCarerName={nannies.length > 1}
          members={members.data ?? []}
        />
      )}
    </ScrollView>
  );
}
