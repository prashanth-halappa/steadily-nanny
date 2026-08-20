/**
 * @module domains/pay/components/ProposalReviewScreen
 *
 * §7.2's route — `/(private)/pay/proposal/[id]`. The screen is a thin shell:
 * the document itself is `ProposalTermsDocument` (the one terms document, in
 * view mode), the binding act is `AcceptTermsSheet`, and a counter reopens
 * 3-U1's `PayChangeSheet` in `propose` mode rather than growing a second
 * terms form (§4.1 — a second form drifts on wording inside a release).
 *
 * **BOTH DIRECTIONS, ONE SCREEN.** The responder is whoever did NOT author
 * the round on screen: a parent answers the nanny's proposal, and once he
 * counters, she opens this same screen with the same two buttons. That is
 * what "both directions everywhere" means — the same three screens with the
 * viewer swapped, not two lifecycles.
 *
 * **THE PROPOSAL ID IS THE ONLY INPUT.** This screen is reached from a push
 * carrying `data.proposalId` and nothing else, so it fetches by that id and
 * takes the (household, carer) pair off the row that comes back. Resolving
 * the pair FIRST — from the active household and the household's member list
 * — would put a round trip in front of a screen §12 says must paint from its
 * route params, and would strand a two-nanny household with no carer to pick.
 * The chain behind "How we got here" is the one pair-scoped read, and it is
 * deliberately not part of the loading gate: the figure paints as soon as the
 * proposal lands, and the history fills in behind it.
 *
 * **THE HOUSEHOLD COMES OFF THE ROW TOO** (Pattern A,
 * `docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §A). The family's name, timezone and
 * week start are resolved from the proposal's OWN `household_id` via
 * `useHouseholdById` — never from the switcher, which answers "which household
 * is she looking at right now" and is only accidentally the same one. A nanny
 * in family A opening family B's proposal read family A's name and zone
 * against family B's money. This screen resolves; it never switches.
 *
 * Loading follows §12: the back row and the title render immediately from the
 * route, and the body is a card-shaped skeleton — never a centred spinner on
 * a screen someone opened from a push notification about money.
 */

import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  type HouseholdRole,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { MomentCard } from '@/src/components/ui/moment-card';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import { Text } from '@/src/components/ui/text';
import { Body, H1 } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { DEFAULT_WEEK_STARTS_ON } from '@/src/domains/timesheet/utils/week';
import { useAcceptTerms } from '@/src/hooks/mutations/useAcceptTerms';
import { useCounterTerms } from '@/src/hooks/mutations/useCounterTerms';
import { useDeclineTerms } from '@/src/hooks/mutations/useDeclineTerms';
import { useMarkProposalViewed } from '@/src/hooks/mutations/useMarkProposalViewed';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdById } from '@/src/hooks/queries/useHouseholdById';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useMyMemberships } from '@/src/hooks/queries/useMyMemberships';
import { useTermsProposal } from '@/src/hooks/queries/useTermsProposal';
import { useTermsProposals } from '@/src/hooks/queries/useTermsProposals';
import { analytics } from '@/src/lib/analytics/analytics';
import { ANALYTICS_EVENTS } from '@/src/lib/analytics/events';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney } from '@/src/lib/money';
import { useIsOnline } from '@/src/lib/network';
import { useAuthStore } from '@/src/store/auth';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import {
  arrangementFromProposal,
  buildProposalChain,
} from '../utils/proposalTerms';
import { AcceptTermsSheet } from './AcceptTermsSheet';
import { BackRow } from './BackRow';
import { DeclineTermsDialog } from './DeclineTermsDialog';
import { PayChangeSheet } from './PayChangeSheet';
import { ProposalTermsDocument } from './ProposalTermsDocument';

const MILLIS_PER_HOUR = 3_600_000;

/**
 * F19 — who has payroll standing in a household, and so may answer terms.
 *
 * A HELPER has none at all (B5 / D-21): she is not shown a disabled Agree, she
 * is not offered one. A POSITIVE list, like every role set in
 * `household.schema.ts` — a role added tomorrow is excluded by construction.
 */
const RESPONDING_ROLES: readonly HouseholdRole[] = [
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
  HOUSEHOLD_ROLES.NANNY,
];

function normalizeParam(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  const first = Array.isArray(value) ? value[0] : value;
  return first == null || first === '' ? null : first;
}

/**
 * §11 event 5 fires FIRST TIME PER PROPOSAL PER USER. A module-level set,
 * not component state: this screen remounts on every return from the accept
 * sheet and on every navigation back, and a per-mount guard would count each
 * of those as a fresh view — inflating the denominator of the one funnel step
 * the whole feature is measured on.
 */
const viewedThisSession = new Set<string>();

export function ProposalReviewScreen() {
  const { refreshControl } = usePullToRefresh();
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const proposalId = normalizeParam(params.id) ?? '';

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const userId = useAuthStore(s => s.user?.id ?? null);
  const isOnline = useIsOnline();
  const isNanny = onboarding.role === SETUP_ROLES.NANNY;

  const proposal = useTermsProposal(proposalId);
  const data = proposal.data;
  // The pair comes off the row, never from the route — see the module doc.
  const chainRows =
    useTermsProposals(data?.household_id ?? null, data?.carer_id ?? null)
      .data ?? [];
  // Pattern A: the household comes off the ROW, like the (household, carer)
  // pair above it. `useMyMemberships` is already in flight for this screen —
  // `useIsOnboarded` reads the same query — so this is a cache hit, not a
  // second round trip.
  const target = useHouseholdById(data?.household_id);
  const memberships = useMyMemberships().data;
  const accept = useAcceptTerms(proposalId);
  const counter = useCounterTerms(
    data?.household_id ?? '',
    data?.carer_id ?? ''
  );
  const markViewed = useMarkProposalViewed(proposalId);
  const decline = useDeclineTerms(proposalId);

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const openedAt = useRef(Date.now());

  // The proposal's household, ALWAYS. `?? activeHousehold.household` covers
  // only the one render between the proposal landing and the households list
  // resolving — it is a gap-filler, never a policy of reading the switcher.
  const household = target.household ?? activeHousehold.household;
  // The reader's row in the PROPOSAL's household. `onboarding.role` and
  // `onboarding.isPastMember` both answer for the ACTIVE one, which is a
  // different household the moment a deep link is involved.
  const myMembership =
    memberships?.find(
      m => m.household_id === data?.household_id && m.user_id === userId
    ) ?? null;
  const chain = data ? buildProposalChain(chainRows, data) : [];
  const round = chain.length;

  useEffect(() => {
    if (!data || !userId) return;
    const key = `${userId}:${data.id}`;
    if (viewedThisSession.has(key)) return;
    viewedThisSession.add(key);
    analytics.track(ANALYTICS_EVENTS.PROPOSAL_VIEWED, {
      proposal_id: data.id,
      round,
      // ponytail: §11 wants `code_hash` here — the join key spanning the
      // pre-auth hop from `terms_shared` to `code_redeemed`. The proposal wire
      // shape carries `from_invite_id` and no hash, and the raw code is never
      // on this device, so the invite id goes out instead and the funnel joins
      // on that. Swap to `code_hash` the moment the endpoint returns one.
      invite_id: data.from_invite_id,
    });
    // `viewed_at` is "whether", never "how many" — only the first reader
    // stamps it.
    if (data.viewed_at === null) markViewed.mutate();
  }, [data, userId, round, markViewed]);

  if (proposal.isPending) {
    return (
      <ScrollView
        testID="proposal-review-screen"
        className="flex-1 bg-background"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
        refreshControl={refreshControl}
      >
        <BackRow
          testID="proposal-back"
          onPress={() => router.back()}
          label={tCommon('back')}
        />
        <H1 className="mt-1">{t('proposal.reviewTitleFallback')}</H1>
        <Card testID="proposal-loading" className="mt-4">
          <CardContent className="gap-3">
            <SkeletonShimmer width={140} height={40} borderRadius={8} />
            <SkeletonShimmer width={220} height={18} borderRadius={4} />
            <SkeletonShimmer width={280} height={18} borderRadius={4} />
          </CardContent>
        </Card>
      </ScrollView>
    );
  }

  if (proposal.isError || !data) {
    return (
      <View testID="proposal-review-screen" className="flex-1 bg-background">
        <ErrorState variant="network" onRetry={() => proposal.refetch()} />
      </View>
    );
  }

  // A push naming a household she is in neither list for. Showing her the
  // household she IS on would answer a different question than the push asked
  // — with money on it.
  if (target.notMember) {
    return (
      <View testID="proposal-not-member" className="flex-1 bg-background">
        <ErrorState
          variant="notFound"
          title={tCommon('deepLink.notMember.title')}
          message={tCommon('deepLink.notMember.message')}
          secondaryLabel={tCommon('deepLink.notMember.action')}
          onSecondaryAction={() => router.replace('/(private)/(tabs)/home')}
        />
      </View>
    );
  }

  const arrangement = arrangementFromProposal(data);
  // The reader's counterparty: a parent reads the nanny's name, a nanny reads
  // the family's. No extra query — both names are already on hand.
  const counterpartyName = isNanny
    ? (household?.name ?? t('proposal.theFamily'))
    : data.carer_display_name;
  // The owner flips with every counter: whoever wrote the round on screen is
  // waiting, and the other side acts. A past member acts on nothing, and a
  // helper never had standing to begin with (F19) — both asked of the
  // PROPOSAL's household, not the switcher's.
  const canRespond =
    data.status === 'proposed' &&
    userId !== null &&
    data.proposed_by !== userId &&
    myMembership !== null &&
    myMembership.status !== HOUSEHOLD_MEMBER_STATUSES.REMOVED &&
    RESPONDING_ROLES.includes(myMembership.role);

  const handleAgree = () => {
    accept
      .mutateAsync({ responsibility_confirmed: true })
      .then(accepted => {
        // §11 event 7: only once the arrangement insert has RETURNED. Never on
        // the optimistic tap — an event fired before the write lands counts
        // acceptances that never happened.
        if (accepted.accepted_arrangement_id) {
          analytics.track(ANALYTICS_EVENTS.PROPOSAL_ACCEPTED, {
            proposal_id: data.id,
            round,
            hours_to_accept: Math.round(
              (openedAt.current - new Date(data.created_at).getTime()) /
                MILLIS_PER_HOUR
            ),
            invite_id: data.from_invite_id,
          });
        }
        setAcceptOpen(false);
        setAgreed(true);
      })
      // The failure is already rendered inline in the sheet, which stays open
      // with the box still checked (§12). A second report here would be the
      // one that disappears.
      .catch(() => undefined);
  };

  // B4 — the counterparty's refusal. `useDeclineTerms` already reports a
  // failure via its own toast (same shape as `useWithdrawTerms`), so there is
  // nothing further to render here on catch.
  const handleDecline = () => {
    decline
      .mutateAsync()
      .then(() => {
        setDeclineOpen(false);
        router.back();
      })
      .catch(() => undefined);
  };

  if (agreed) {
    // `/settings/pay` is the PARENT's management surface — a carer is
    // gated to `pay-not-available` there (PayArrangementScreen's
    // `isParentEditorRole` check). A carer who just accepted (the B1
    // path) lands on her own read-only surface instead.
    const continueToTerms = () =>
      router.replace(isNanny ? '/settings/my-pay' : '/settings/pay');
    return (
      <ScrollView
        testID="proposal-review-screen"
        className="flex-1 bg-background"
        contentContainerStyle={SCREEN_CONTENT_STYLE}
        refreshControl={refreshControl}
      >
        <MomentCard
          testID="terms-agreed-moment"
          illustration="emptyPay"
          title={t('moments.termsAgreed.title', { name: counterpartyName })}
          body={t('moments.termsAgreed.body', {
            rate: formatMoney(arrangement.rate_minor, arrangement.currency),
            date: formatDisplayDateWithYear(arrangement.valid_from),
          })}
          action={{
            label: t('moments.termsAgreed.cta'),
            onPress: continueToTerms,
            testID: 'terms-agreed-continue',
          }}
          momentKey={`termsAgreed:${data.id}`}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      testID="proposal-review-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
      refreshControl={refreshControl}
    >
      <BackRow
        testID="proposal-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1 testID="proposal-title" className="mt-1">
        {isNanny
          ? t('proposal.reviewTitleFamily', { name: counterpartyName })
          : t('proposal.reviewTitle', { name: data.carer_display_name })}
      </H1>
      <Body
        testID="proposal-not-agreed-yet"
        className="mt-2 text-muted-foreground"
      >
        {t('proposal.notAgreedYet')}
      </Body>

      <View className="mt-4">
        <ProposalTermsDocument
          proposal={data}
          chain={chain}
          viewerId={userId ?? ''}
          counterpartyName={counterpartyName}
          timezone={household?.timezone ?? 'UTC'}
        />
      </View>

      {canRespond ? (
        <View className="mt-6 gap-2">
          <Button
            testID="proposal-agree-button"
            size="lg"
            onPress={() => setAcceptOpen(true)}
          >
            <Text>{t('proposal.agreeButton')}</Text>
          </Button>
          <Button
            testID="proposal-counter-button"
            variant="outline"
            onPress={() => setCounterOpen(true)}
          >
            <Text className="text-foreground">
              {t('proposal.counterButton')}
            </Text>
          </Button>
          <Button
            testID="proposal-decline-button"
            variant="ghost"
            onPress={() => setDeclineOpen(true)}
          >
            <Text className="text-foreground">
              {t('proposal.declineButton')}
            </Text>
          </Button>
        </View>
      ) : null}

      <AcceptTermsSheet
        visible={acceptOpen}
        proposal={data}
        accepterRole={isNanny ? 'carer' : 'parent'}
        isSubmitting={accept.isPending}
        isError={accept.isError}
        isOnline={isOnline}
        onAgree={handleAgree}
        onDismiss={() => setAcceptOpen(false)}
      />

      <DeclineTermsDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        onConfirm={handleDecline}
        isSubmitting={decline.isPending}
      />

      {/* 3-U1's form, pre-filled from the proposal. D-16 is live server-side,
          so a future `valid_from` — the NORMAL interview case — passes
          straight through; nothing here clamps it to today (§7.4). */}
      <PayChangeSheet
        mode="propose"
        counterpartyName={counterpartyName}
        visible={counterOpen}
        onDismiss={() => setCounterOpen(false)}
        onSubmit={terms => {
          counter
            .mutateAsync({ terms, supersedes_id: data.id })
            .then(() => {
              analytics.track(ANALYTICS_EVENTS.PROPOSAL_COUNTERED, {
                proposal_id: data.id,
                round,
                by_role: isNanny ? 'carer' : 'parent',
              });
              setCounterOpen(false);
              router.back();
            })
            // Failure renders inline INSIDE the sheet (GOLDEN #40), which
            // stays open with every typed value intact.
            .catch(() => undefined);
        }}
        isSubmitting={counter.isPending}
        submitError={counter.isError ? t('proposal.sendFailed') : null}
        currentArrangement={arrangement}
        householdCancellationDefaultHours={
          household?.cancellation_paid_within_hours ?? 0
        }
        householdTimezone={household?.timezone ?? 'UTC'}
        householdWeekStartsOn={
          household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON
        }
        todayISO={localDateInZone(household?.timezone ?? 'UTC')}
        initialEffectiveDateISO={arrangement.valid_from}
      />
    </ScrollView>
  );
}
