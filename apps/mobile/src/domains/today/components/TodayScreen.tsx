/**
 * @module domains/today/components/TodayScreen
 *
 * The first tab after setup, for both roles. Shows household context, the
 * nanny's clock-in card, and the entry points into the schedule.
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
 *
 * For the same reason it, and `NeedsAttentionCard`, come FIRST: a card that is
 * invisible unless it needs action costs nothing at the top and is useless at
 * the bottom. Below the routine cards the respond CTA rendered past the end of
 * the scroll viewport, so a nanny with a week waiting saw no call to action.
 */

import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, View } from 'react-native';
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
  TermsProposalCard,
  useInboxItems,
} from '@/src/domains/inbox';
import {
  PendingScheduleCard,
  ThisWeeksShiftsCard,
} from '@/src/domains/schedule';
import { localDateToWeekday } from '@/src/domains/schedule/utils/shiftGrouping';
import { canViewParentSchedule, SETUP_ROLES } from '@/src/domains/setup/types';
import {
  DEFAULT_WEEK_STARTS_ON,
  formatDisplayDate,
} from '@/src/domains/timesheet/utils/week';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { useTodayCardDismissalStore } from '@/src/store/todayCardDismissalStore';
import { useHouseholdIsLive } from '../hooks/useHouseholdIsLive';
import { useOverdueClockOut } from '../hooks/useOverdueClockOut';
import { useTodayCoverRows } from '../hooks/useTodayCoverRows';
import { useUncoveredToday } from '../hooks/useUncoveredToday';
import { resolveAttentionOwner } from '../utils/attentionOwner';
import { HERO_MOOD_ILLUSTRATION, resolveHeroMood } from '../utils/heroMood';
import { buildJoinedComposition } from '../utils/joinedComposition';
import { AddMissedHoursCard } from './AddMissedHoursCard';
import { ClockInCard } from './ClockInCard';
import { HandoffChipsCard } from './HandoffChipsCard';
import { NannyWeekLine } from './NannyWeekLine';
import { TodayCoverage } from './TodayCoverage';

/**
 * How recently she must have joined for §8.1's arrival card to still be true.
 * A week: long enough to survive not opening the app for a few days after
 * starting a placement, short enough that it can never read as news about a
 * household she has worked in for months.
 */
const JOINED_CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  // One T1 per screen: `resolveAttentionOwner` (its own module doc carries
  // the ranking + justification) is the single decision every
  // attention-capable card demotes against, so a fourth surface extends
  // the ladder there instead of colliding with these two.
  const { overdue: clockOutOverdue } = useOverdueClockOut();
  const inbox = useInboxItems();
  const hasTermsProposal =
    !inbox.isLoading &&
    inbox.items.some(item => item.kind === 'terms_proposal');
  const uncoveredToday = useUncoveredToday(household?.id, household?.timezone);
  const attentionOwner = resolveAttentionOwner({
    overdue: clockOutOverdue,
    hasUncoveredCare: uncoveredToday.status === 'uncovered',
    hasTermsProposal,
    hasInboxItems: !inbox.isLoading && inbox.items.length > 0,
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
    onboarding.role === SETUP_ROLES.NANNY &&
    !onboarding.isPastMember &&
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
  // Same tab-bar dead-zone fix as Settings (BUG1) — the floating tab bar
  // overlays this screen's content instead of reserving its own layout
  // space, so a fixed paddingBottom is not safe-area-aware.
  const tabBarScrollPadding = useTabBarScrollPadding();

  // §S6 item 4 / D-36: while the active household is a draft, this screen IS
  // `DraftHomeScreen` — self-contained (own scroll, own H1, own switcher),
  // never the slot+feed body below. After every hook this component calls,
  // so the branch never skips one (rules of hooks).
  if (household?.state === HOUSEHOLD_STATES.DRAFT) {
    return <DraftHomeScreen />;
  }

  return (
    <View className="flex-1 bg-background">
      {/* Always mounted now, brand plum by default and apricot only while
          someone is on the clock. The screen used to be flat warm grey for
          the other sixteen hours of the day (daylight-v2 §4.3). */}
      <ScreenWash testID="today-live-wash" kind={isLive ? 'live' : 'brand'} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          ...SCREEN_CONTENT_STYLE,
          paddingBottom: tabBarScrollPadding,
        }}
      >
        {/* Hero band — no card, no ground of its own: it IS the top of the
            wash, and the wash is what separates it from the cards below. */}
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
              <Small testID="today-date" className="mt-1 text-muted-strong">
                {`${tSchedule(`weekday.${localDateToWeekday(localDateInZone(household.timezone))}`)} ${formatDisplayDate(localDateInZone(household.timezone))}${
                  activeHousehold.households.length +
                    activeHousehold.pastHouseholds.length <=
                    1 && !activeHousehold.isPastHousehold
                    ? ` · ${household.name}`
                    : ''
                }`}
              </Small>
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

        {activeHousehold.isLoading ? (
          <LoadingIndicator />
        ) : household ? (
          <View className="mt-2 gap-4">
            <HouseholdSwitcher />

            {canViewParentSchedule(onboarding.role) ? (
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

            {/* §8.1 — once per household, above everything else: she was not
                present when the family redeemed her code, and this is the
                "after" half of that. */}
            {showJoinedCard && household ? (
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

            {/* Both of these render nothing unless something is genuinely
                waiting on this person — deliberately not empty states. A card
                announcing its own absence is noise on the screen people open
                most, which is exactly why they can sit ABOVE the routine cards
                for free: on an ordinary day there is nothing here to scroll
                past. Order is load-bearing — behind the routine cards the
                respond CTA fell below the fold, and it is the only route into
                the accept flow. See TodayScreen.cardOrder.test.tsx. */}
            <NeedsAttentionCard demoted={attentionOwner !== 'inbox'} />
            <TermsProposalCard demoted={attentionOwner !== 'termsProposal'} />
            <PendingScheduleCard />

            {/* §9.2 — an L3, non-urgent, one-time offer. Below the attention
                group on purpose (`attention-and-notifications.md` §2.5: no
                new `demoted` prop, no attentionOwner rung). Self-contained —
                no props, same shape as PendingScheduleCard. */}
            <SendMyTermsCard />

            {/* Not on a household she was REMOVED from: every write there is
                refused server-side, so the button would only ever fail. */}
            {onboarding.role === SETUP_ROLES.NANNY &&
            !onboarding.isPastMember ? (
              <ClockInCard
                householdId={household.id}
                timeZone={household.timezone}
                weekStartsOn={household.week_starts_on}
                // A DRAFT household has no name yet (093 §4.2). This prop is
                // the multi-household disambiguator ("Clocked into X"), so
                // `undefined` would hide the one line telling her WHICH
                // household she is on the clock for — label it instead.
                householdName={household.name ?? t('household:untitledDraft')}
              />
            ) : null}

            {/* Forgotten clock-in recovery — same active-membership guard
                as ClockInCard: a write here 403s server-side on a household
                she was removed from, so offering the affordance there would
                be a lie. */}
            {onboarding.role === SETUP_ROLES.NANNY &&
            !onboarding.isPastMember ? (
              <NannyWeekLine
                householdId={household.id}
                timeZone={household.timezone}
                weekStartsOn={household.week_starts_on}
              />
            ) : null}

            {onboarding.role === SETUP_ROLES.NANNY &&
            !onboarding.isPastMember ? (
              <AddMissedHoursCard
                householdId={household.id}
                timeZone={household.timezone}
                weekStartsOn={household.week_starts_on}
              />
            ) : null}

            {canViewParentSchedule(onboarding.role) ? (
              <TodayCoverage
                householdId={household.id}
                timeZone={household.timezone}
                weekStartsOn={household.week_starts_on}
                householdChildren={children.data ?? []}
                demoted={attentionOwner !== 'uncoveredCare'}
              />
            ) : null}

            {onboarding.role ? (
              <HandoffChipsCard
                householdId={household.id}
                timeZone={household.timezone}
                role={onboarding.role}
              />
            ) : null}

            <ThisWeeksShiftsCard />
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
