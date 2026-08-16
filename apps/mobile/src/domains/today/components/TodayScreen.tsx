/**
 * @module domains/today/components/TodayScreen
 *
 * The first tab after setup, for both roles. It is ONE CONTROL PLUS A FEED,
 * and the layout now says so.
 *
 * The screen used to be eleven possible cards in a single ScrollView, with
 * sort ORDER as the only thing keeping the most important control on screen.
 * That is unenforceable: one more child chip or a two-line family name pushes
 * the top card under the fold, and it did — the respond CTA rendered at
 * y 881–929 with the viewport ending at 873, and the tap landed on the Hours
 * tab underneath. A test can pin an order; nothing can pin pixels.
 *
 * So the column is: `ScreenWash` → a STATIC header (H1, date line, hero art)
 * → `<PinnedSlot>` holding at most ONE item → the scrolling feed. The slot is
 * a plain sibling `View` in normal flow, so it RESERVES its height and the
 * ScrollView's `flex-1` shrinks under it — `useTabBarScrollPadding` can only
 * ever help scrolled content, which is why a floating element was the bug.
 * The household switcher and the child chips scroll with the feed.
 *
 * `resolveSlotOccupant` (fed by `resolveAttentionOwner`) is the only thing
 * that decides what is pinned, and `usePinnedTone` is the only thing that
 * decides what looks urgent — no card carries an emphasis prop of its own any
 * more. A card cannot shout unless it is the slot's single child.
 *
 * Wave B: a nanny can be an accepted member of several households, so WHICH
 * household's data this screen shows can no longer be `households.data?.[0]`
 * — that always showed the same one regardless of which family the nanny
 * actually wants right now. `useActiveHousehold` (not `useHouseholds`
 * directly) resolves that choice; `HouseholdSwitcher` is the only UI for
 * changing it, and renders nothing when there's nothing to switch between
 * (one household, e.g. every parent).
 *
 * `PendingScheduleCard` matters more than it looks: without it a nanny had no
 * way to reach `/schedule/respond/[patternId]` at all — the accept half of
 * "parent proposes, nanny accepts" was only reachable by hand-typing a deep
 * link, which means it was not really shipped. It renders NOTHING when there is
 * no pending week, so it costs an ordinary day nothing.
 */

import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { TIMESHEET_STATUSES } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { H1, Small } from '@/src/components/ui/typography';
import {
  DraftHomeScreen,
  JoinedHouseholdCard,
  SendMyTermsCard,
} from '@/src/domains/draft';
import { HouseholdSwitcher } from '@/src/domains/household';
import {
  NeedsAttentionCard,
  PendingOfferCard,
  TermsProposalCard,
  useInboxItems,
} from '@/src/domains/inbox';
import { usePendingOffer } from '@/src/domains/inbox/hooks/usePendingOffer';
import { PendingScheduleCard } from '@/src/domains/schedule';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { localDateToWeekday } from '@/src/domains/schedule/utils/shiftGrouping';
import { canViewParentSchedule, SETUP_ROLES } from '@/src/domains/setup/types';
import {
  DEFAULT_WEEK_STARTS_ON,
  formatDisplayDate,
} from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useHouseholdTimesheets } from '@/src/hooks/queries/useHouseholdTimesheets';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { useTodayCardDismissalStore } from '@/src/store/todayCardDismissalStore';
import { useHouseholdIsLive } from '../hooks/useHouseholdIsLive';
import { useMomentOnce } from '../hooks/useMomentOnce';
import { useOverdueClockOut } from '../hooks/useOverdueClockOut';
import { useTermsGate } from '../hooks/useTermsGate';
import { useTodayCoverRows } from '../hooks/useTodayCoverRows';
import { useUncoveredToday } from '../hooks/useUncoveredToday';
import { resolveAttentionOwner } from '../utils/attentionOwner';
import { HERO_MOOD_ILLUSTRATION, resolveHeroMood } from '../utils/heroMood';
import { buildJoinedComposition } from '../utils/joinedComposition';
import { resolveSlotOccupant } from '../utils/slotOccupant';
import { ClockInBlockedCard } from './ClockInBlockedCard';
import { ClockInCard } from './ClockInCard';
import { CrossFamilyStrip } from './CrossFamilyStrip';
import { EmergencyContactPromptCard } from './EmergencyContactPromptCard';
import { FirstClockInMomentCard } from './FirstClockInMomentCard';
import { FirstWeekApprovedMomentCard } from './FirstWeekApprovedMomentCard';
import { HandoffChipsCard } from './HandoffChipsCard';
import { NannyJoinedMomentCard } from './NannyJoinedMomentCard';
import { PinnedSlot } from './PinnedSlot';
import { ThisWeekCard } from './ThisWeekCard';
import { TodayCoverage } from './TodayCoverage';

/**
 * How recently she must have joined for §8.1's arrival card to still be true.
 * A week: long enough to survive not opening the app for a few days after
 * starting a placement, short enough that it can never read as news about a
 * household she has worked in for months.
 */
const JOINED_CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const HEADER_STYLE = {
  paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
  paddingTop: SCREEN_CONTENT_STYLE.padding,
  paddingBottom: 8,
} as const;

export function TodayScreen() {
  const { t } = useTranslation('today');
  const { t: tSchedule } = useTranslation('schedule');
  // Server-derived role, NOT the local setupProgress store — that's
  // in-flight wizard UI state and can be empty/stale for a parent whose
  // household was seeded directly, or who signed in on a fresh device. See
  // useIsOnboarded's header comment.
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  const children = useChildren(household?.id);
  const myUserId = useAuthStore(s => s.session?.user?.id);
  const householdMembers = useHouseholdMembers(household?.id);
  const isCardDismissed = useTodayCardDismissalStore(s => s.isDismissed);
  const dismissCard = useTodayCardDismissalStore(s => s.dismiss);
  // Wash while someone is on the clock — caller running OR household week
  // entry running. Stays inside this screen (below the tab navigator).
  const isLive = useHouseholdIsLive(
    household?.id,
    household?.timezone,
    household?.week_starts_on
  );
  const isParentView = canViewParentSchedule(onboarding.role);
  const isPastMember = !!onboarding.isPastMember;
  // S9 / direction §4 — "This family" is nanny/helper-only reference
  // material; a parent has no such screen, so the date line stays inert
  // for her.
  const canOpenThisFamily =
    onboarding.role === SETUP_ROLES.NANNY ||
    onboarding.role === SETUP_ROLES.HELPER;
  const activeNanny = onboarding.role === SETUP_ROLES.NANNY && !isPastMember;
  // One occupant per screen: `resolveAttentionOwner` (its own module doc
  // carries the ranking + justification) ranks the obligations, and
  // `resolveSlotOccupant` maps that onto the single thing the slot holds.
  // A sixth surface extends the ladder there instead of inventing its own
  // emphasis.
  const { overdue: clockOutOverdue, clockInAt } = useOverdueClockOut();
  const inbox = useInboxItems();
  const hasTermsProposal =
    !inbox.isLoading &&
    inbox.items.some(item => item.kind === 'terms_proposal');
  // The two kinds `NeedsAttentionCard` filters out must not count towards
  // "the inbox needs the slot" either, or the slot is handed to a card that
  // then renders nothing — an empty pinned zone with the real card sitting
  // in the feed below it. Both have their own card AND their own rung, so
  // neither is ever lost by being excluded here.
  const hasInboxItems =
    !inbox.isLoading &&
    inbox.items.some(
      item =>
        item.kind !== 'terms_proposal' && item.kind !== 'terms_proposal_sent'
    );
  const uncoveredToday = useUncoveredToday(household?.id, household?.timezone);
  // A1's hard block. Nanny-only and active-member-only: a parent has no
  // clock to block, and every write on a household she was removed from is
  // refused anyway, so blocking there would explain the wrong refusal.
  const termsGate = useTermsGate(household?.id);
  const termsBlocked = activeNanny && termsGate.status === 'blocked';
  // A7's parent-side half. `usePendingOffer` is the SAME hook the card reads,
  // so the ladder and the card can never disagree about whether this offer is
  // loud — a slot pinned with a card that has decided it is quiet is the
  // stacked-attention bug the ladder exists to prevent. Consequence ONLY: a
  // stale offer never reaches this flag, however old it gets.
  const pendingOffer = usePendingOffer();
  const attentionOwner = resolveAttentionOwner({
    termsBlocked,
    hasBlockingSentOffer: pendingOffer.isBlocking,
    overdue: clockOutOverdue,
    // Parent-visible roles ONLY: a nanny never sees `TodayCoverage`, so
    // letting a coverage gap own her ladder handed the slot to a card she
    // cannot see.
    hasUncoveredCare: isParentView && uncoveredToday.status === 'uncovered',
    hasTermsProposal,
    hasInboxItems,
  });
  const slotOccupant = resolveSlotOccupant({
    role: onboarding.role,
    isPastMember,
    onClock: clockInAt !== null,
    attentionOwner,
  });
  // Same rows the coverage surface reads, off the same React Query keys, so
  // the hero illustration costs no extra network. Both roles read the whole
  // household's day: a nanny's own shifts are among these rows.
  const coverRows = useTodayCoverRows(
    household?.id ?? '',
    household?.timezone ?? 'UTC',
    household?.week_starts_on ?? DEFAULT_WEEK_STARTS_ON
  );
  const heroMood = resolveHeroMood({ isLive, rows: coverRows.rows });
  // §8.1 — "You've joined the {family}", once, per household. Nanny-only:
  // she is the one walking into a placement she has never seen. LIVE-only:
  // her OWN draft household is not something she "joined". A `candidate`
  // membership (redeemed, terms not yet accepted) cannot reach this branch
  // at all today — `useActiveHousehold` resolves a household from `active`
  // memberships only (`householdMemberRepository.listActiveHouseholdIds`),
  // so a true candidate's `household` here is null and the empty-state
  // branch below renders instead. The §8.2.1 "waiting" variant this card
  // supports needs an API change to be honest (a route a candidate can
  // actually read); out of scope for a mobile-only change.
  const joinedCardKey = household ? `joinedHousehold:${household.id}` : null;
  // "You've joined the {family}" is an ARRIVAL card, and the dismissal store
  // starts empty on every install. Without a clock, the not-yet-dismissed
  // condition is true for a nanny who joined a year ago, and she is greeted
  // on her next launch by news of her own arrival. Her membership's
  // `joined_at` is the only honest one available — the store cannot tell
  // "never seen it" apart from "seen it before the store existed".
  const myMembership = (householdMembers.data ?? []).find(
    m => m.user_id === myUserId
  );
  const joinedRecently =
    myMembership !== undefined &&
    Date.now() - new Date(myMembership.joined_at).getTime() <
      JOINED_CARD_MAX_AGE_MS;
  const showJoinedCard =
    activeNanny &&
    !!household &&
    household.state === HOUSEHOLD_STATES.LIVE &&
    !!joinedCardKey &&
    !isCardDismissed(joinedCardKey) &&
    !children.isLoading &&
    !householdMembers.isLoading &&
    joinedRecently;
  // The first render with `showJoinedCard` true IS the reveal — this card has
  // no "Not now" of its own (unlike `SendMyTermsCard`) to hang a dismissal
  // off, so marking it seen here is what makes it a "renders once" card.
  useEffect(() => {
    if (showJoinedCard && joinedCardKey) dismissCard(joinedCardKey);
  }, [showJoinedCard, joinedCardKey, dismissCard]);
  // Stream U3 — parent-side joined moment + the two "first" moments. Hooks
  // stay unconditional (the draft early-return is below). Keys are null
  // until every gate is honest, so useMomentOnce does not persist a miss.
  const timesheets = useHouseholdTimesheets(household?.id);
  const recentNannyMember = [...(householdMembers.data ?? [])]
    .filter(m => m.role === 'nanny')
    .filter(
      m => Date.now() - new Date(m.joined_at).getTime() < JOINED_CARD_MAX_AGE_MS
    )
    .sort(
      (a, b) =>
        new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime()
    )[0];
  const parentJoinedKey =
    isParentView &&
    household?.state === HOUSEHOLD_STATES.LIVE &&
    !householdMembers.isLoading &&
    recentNannyMember &&
    household
      ? `nannyJoined:${household.id}:${recentNannyMember.user_id}`
      : null;
  const showParentJoinedMoment = useMomentOnce(parentJoinedKey);
  const firstClockInKey =
    activeNanny && clockInAt !== null && joinedRecently && household
      ? `firstClockIn:${household.id}`
      : null;
  const showFirstClockInMoment = useMomentOnce(firstClockInKey);
  const herApprovedTimesheets = (timesheets.data ?? []).filter(
    sheet =>
      sheet.carer_id === myUserId &&
      sheet.status === TIMESHEET_STATUSES.APPROVED
  );
  const firstApprovedTimesheet =
    herApprovedTimesheets.length === 1 ? herApprovedTimesheets[0] : undefined;
  const firstWeekApprovedKey =
    activeNanny &&
    !timesheets.isLoading &&
    herApprovedTimesheets.length === 1 &&
    household
      ? `firstWeekApproved:${household.id}`
      : null;
  const showFirstWeekApprovedMoment = useMomentOnce(firstWeekApprovedKey);
  // Same tab-bar dead-zone fix as Settings (BUG1) — the floating tab bar
  // overlays this screen's content instead of reserving its own layout
  // space, so a fixed paddingBottom is not safe-area-aware.
  const tabBarScrollPadding = useTabBarScrollPadding();

  // §S6 item 4 / D-36: while the active household is a draft, this screen IS
  // `DraftHomeScreen` — self-contained (own scroll, own H1, own switcher),
  // never the slot+feed body below. After every hook this component calls,
  // so the branch never skips one (rules of hooks), and before the slot
  // occupant is computed — a draft has no slot to fill.
  if (household?.state === HOUSEHOLD_STATES.DRAFT) {
    return <DraftHomeScreen />;
  }

  const clockInCard = household ? (
    <ClockInCard
      householdId={household.id}
      timeZone={household.timezone}
      weekStartsOn={household.week_starts_on}
      // A DRAFT household has no name yet (093 §4.2). This prop is the
      // multi-household disambiguator ("Clocked into X"), so `undefined`
      // would hide the one line telling her WHICH household she is on the
      // clock for — label it instead.
      householdName={household.name ?? t('household:untitledDraft')}
    />
  ) : null;
  const handoffCard =
    household && onboarding.role ? (
      <HandoffChipsCard
        householdId={household.id}
        timeZone={household.timezone}
        role={onboarding.role}
      />
    ) : null;

  const pinned = (() => {
    if (!household) return null;
    switch (slotOccupant) {
      case 'clockIn':
        return clockInCard;
      case 'coverageGap':
        // No `footer` here: the slot holds exactly one thing, so the handoff
        // chips stand alone in the feed instead.
        return (
          <TodayCoverage
            householdId={household.id}
            timeZone={household.timezone}
            weekStartsOn={household.week_starts_on}
            householdChildren={children.data ?? []}
          />
        );
      case 'termsProposal':
        return <TermsProposalCard />;
      case 'inbox':
        return <NeedsAttentionCard />;
      case 'blockedClockIn':
        return <ClockInBlockedCard household={household} />;
      case 'pendingOffer':
        return <PendingOfferCard />;
      default:
        return null;
    }
  })();

  return (
    <View className="flex-1 bg-background">
      {/* Always mounted now, brand plum by default and apricot only while
          someone is on the clock. The screen used to be flat warm grey for
          the other sixteen hours of the day (daylight-v2 §4.3). */}
      <ScreenWash testID="today-live-wash" kind={isLive ? 'live' : 'brand'} />

      {/* P5/S10 — cross-family, unscoped by design: renders above every
          household-scoped surface on this screen (never in `PinnedSlot`,
          never a `Card`) and is null for the common case (nothing urgent
          in her other families, or a parent's single-household account). */}
      <CrossFamilyStrip />

      {/* Hero band — no card, no ground of its own: it IS the top of the
          wash, and the wash is what separates it from the cards below. It is
          static so the slot beneath it is at a knowable y. */}
      <View style={HEADER_STYLE}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <H1 testID="today-header">{t('screenTitle')}</H1>
            {/* Folded into the H1 block: the date always shows (a screen
                called Today with no date on it is odd), and the household
                name joins it on the same line — but only when there's
                nothing to switch between. Mirrors HouseholdSwitcher's own
                bail-out; rendering both would print the household twice.
                `text-muted-strong`, not `text-muted-foreground`: this line
                sits on the wash, where mutedForeground is 4.28:1 (Rule M). */}
            {household ? (
              <Pressable
                testID="today-family-link"
                disabled={!canOpenThisFamily}
                accessibilityRole={canOpenThisFamily ? 'button' : undefined}
                onPress={
                  canOpenThisFamily
                    ? () =>
                        router.push('/(private)/settings/this-family' as Href)
                    : undefined
                }
              >
                <Small testID="today-date" className="mt-1 text-muted-strong">
                  {`${tSchedule(`weekday.${localDateToWeekday(localDateInZone(household.timezone))}`)} ${formatDisplayDate(localDateInZone(household.timezone))}${
                    activeHousehold.households.length +
                      activeHousehold.pastHouseholds.length <=
                      1 && !activeHousehold.isPastHousehold
                      ? ` · ${household.name}`
                      : ''
                  }`}
                </Small>
              </Pressable>
            ) : null}
          </View>
          {/* Transparent PNG on purpose — the wash gradient passes under it. */}
          <Image
            testID={`today-hero-art-${heroMood}`}
            accessibilityRole="image"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            source={illustrations[HERO_MOOD_ILLUSTRATION[heroMood]]}
            style={{ width: 104, height: 104 }}
            resizeMode="contain"
          />
        </View>
      </View>

      {/* THE slot. One item, outside the ScrollView, in normal flow. */}
      <PinnedSlot>{activeHousehold.isLoading ? null : pinned}</PinnedSlot>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
          paddingBottom: tabBarScrollPadding,
        }}
      >
        {activeHousehold.isLoading ? (
          <LoadingIndicator />
        ) : household ? (
          <View className="gap-4">
            <HouseholdSwitcher />

            {isParentView ? (
              <View
                className="flex-row flex-wrap gap-2"
                testID="today-children"
              >
                {(children.data ?? []).map(child => (
                  <ChildChip
                    key={child.id}
                    name={child.name}
                    colour={child.colour ?? undefined}
                  />
                ))}
              </View>
            ) : null}

            {/* §8.1 — once per household, above everything else in the feed:
                she was not present when the family redeemed her code, and
                this is the "after" half of that. */}
            {showJoinedCard ? (
              <JoinedHouseholdCard
                familyName={household.name ?? t('household:untitledDraft')}
                composition={buildJoinedComposition(
                  children.data ?? [],
                  householdMembers.data ?? [],
                  myUserId
                )}
                onSeeTerms={() =>
                  router.push('/(private)/settings/my-pay' as Href)
                }
              />
            ) : null}
            {showParentJoinedMoment && recentNannyMember ? (
              <NannyJoinedMomentCard
                name={resolveCarerName(recentNannyMember, '')}
                family={household.name ?? t('household:untitledDraft')}
                carerId={recentNannyMember.user_id}
                momentKey={parentJoinedKey}
              />
            ) : null}
            {showFirstClockInMoment ? (
              <FirstClockInMomentCard
                family={household.name ?? t('household:untitledDraft')}
                momentKey={firstClockInKey}
              />
            ) : null}
            {showFirstWeekApprovedMoment && firstApprovedTimesheet ? (
              <FirstWeekApprovedMomentCard
                householdName={household.name ?? t('household:untitledDraft')}
                totalMinutes={firstApprovedTimesheet.total_minutes}
                approvedAt={
                  firstApprovedTimesheet.approved_at ??
                  firstApprovedTimesheet.week_start
                }
                momentKey={firstWeekApprovedKey}
              />
            ) : null}

            {/* Both of these render nothing unless something is genuinely
                waiting on this person — deliberately not empty states. When
                one of them owns the slot it is NOT mounted again here: two
                copies of one obligation is the collision the slot exists to
                end. In the feed they keep their content and CTA at default
                tone (`usePinnedTone`). */}
            {slotOccupant === 'inbox' ? null : <NeedsAttentionCard />}
            {/* Quiet on every day it is not blocking, which is nearly all of
                them — it renders nothing at all when there is no live offer
                he wrote. */}
            {slotOccupant === 'pendingOffer' ? null : <PendingOfferCard />}
            {/* Not while blocked: the blocked card IS the review CTA, and a
                second card about the same unanswered proposal is exactly the
                collision the pinned slot exists to end. */}
            {slotOccupant === 'termsProposal' ||
            slotOccupant === 'blockedClockIn' ? null : (
              <TermsProposalCard />
            )}
            <PendingScheduleCard />

            {/* §9.2 — an L3, non-urgent, one-time offer. Below the attention
                group on purpose, and never a slot occupant. Self-contained —
                no props, same shape as PendingScheduleCard. */}
            <SendMyTermsCard />

            {/* S9 / direction §6 — a second, unrelated one-time offer, same
                shape as the one above it: self-contained, feed-only, never a
                slot occupant. */}
            <EmergencyContactPromptCard />

            {/* Not on a household she was REMOVED from: every write there is
                refused server-side, so the button would only ever fail. */}
            {/* A clock-in button she cannot use is not a smaller version of
                the block — it is the block denied. */}
            {activeNanny &&
            slotOccupant !== 'clockIn' &&
            slotOccupant !== 'blockedClockIn'
              ? clockInCard
              : null}

            <ThisWeekCard
              householdId={household.id}
              timeZone={household.timezone}
              weekStartsOn={household.week_starts_on}
              role={onboarding.role}
              isPastMember={isPastMember}
            />

            {isParentView && slotOccupant !== 'coverageGap' ? (
              <TodayCoverage
                householdId={household.id}
                timeZone={household.timezone}
                weekStartsOn={household.week_starts_on}
                householdChildren={children.data ?? []}
                // A handoff IS a coverage fact (#9's merge), so it folds in
                // here rather than standing as its own card.
                footer={handoffCard}
              />
            ) : null}

            {/* Standalone only where there is no coverage surface to fold
                into: a nanny never has one, and a parent's is in the slot. */}
            {!isParentView || slotOccupant === 'coverageGap'
              ? handoffCard
              : null}
          </View>
        ) : null}

        {/* Only an honest empty state while there is no household at all. Once
            there is one, the cards above carry the schedule story. */}
        {activeHousehold.isLoading || household ? null : (
          <View className="mt-8" testID="today-empty">
            <EmptyState
              variant="inline"
              image={illustrations.emptyToday}
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
