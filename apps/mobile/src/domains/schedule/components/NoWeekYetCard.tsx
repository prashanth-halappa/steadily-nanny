/**
 * @module domains/schedule/components/NoWeekYetCard
 *
 * A nanny who has joined a family and agreed the pay terms opens Today and
 * sees a clock-in button and nothing else. Nothing tells her the family
 * hasn't sent a usual week, so she cannot tell whether they forgot or simply
 * haven't got there yet. This card says so, once a week at most, and asks
 * nothing of her.
 *
 * NO "nudge the family" BUTTON, deliberately. She must never be made to feel
 * she is chasing her employer —
 * `docs/design/attention-and-notifications.md` §2.3(c) already refused
 * `stale_submitted_week` a push for exactly this reason, and §2.4(a) names
 * the failure mode. The two CTAs are both `ghost`: a filled plum button is
 * the visual grammar of "you owe someone this", and she owes nobody
 * anything. The availability link is the one genuinely useful thing on the
 * card — the builder warns on hours outside her availability
 * (`build.outsideHoursWarning`), so keeping it current materially improves
 * the week she gets sent.
 *
 * A FEED CARD, NEVER A SLOT OCCUPANT. She is not blocked and nothing is
 * waiting on her, so this touches neither `attentionOwner.ts` nor
 * `slotOccupant.ts` — `ClockInCard` keeps the top of her screen.
 *
 * Takes no props and renders `null` on an ordinary day, same shape as
 * `PendingScheduleCard`. Every decision lives in `NoWeekYetCard.utils`.
 */
import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { SCHEDULE_PATTERN_STATUSES } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { SCHEDULED_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { type Href, useRouter } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Body, H4 } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { getWeekStartISO } from '@/src/domains/timesheet/utils/week';
import { useTermsGate } from '@/src/domains/today/hooks/useTermsGate';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { useTodayCardDismissalStore } from '@/src/store/todayCardDismissalStore';
import { resolveActivePattern } from '../utils/patternPrecedence';
import { resolveNoWeekYet } from './NoWeekYetCard.utils';

const AVAILABILITY_HREF = '/(private)/settings/availability' as Href;

/** `draft`/`declined`/`cancelled` are not work booked — they must not suppress the card. */
const SCHEDULED_STATUS_SET = new Set<string>(SCHEDULED_SHIFT_STATUSES);

/** Mirrors `TodayScreen`'s window for its §8.1 joined card (module-private there). */
const JOINED_CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function NoWeekYetCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  const myUserId = useAuthStore(s => s.session?.user?.id);
  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  const householdId = household?.id;

  const isDismissed = useTodayCardDismissalStore(s => s.isDismissed);
  const dismiss = useTodayCardDismissalStore(s => s.dismiss);

  // `useTermsGate` is the single place that answers "are terms agreed in this
  // household" (it wraps `useCurrentPayArrangement` + the open proposal, and
  // fails OPEN on error). It also hands back the family's name for the copy,
  // so this card never has to resolve it a second way.
  const termsGate = useTermsGate(householdId);

  const patterns = useSchedulePatterns(householdId);
  const activePattern = resolveActivePattern(patterns.data ?? []);

  const members = useHouseholdMembers(householdId);

  const timeZone = household?.timezone ?? 'UTC';
  const today = localDateInZone(timeZone);
  // Full ISO datetimes with an offset — the route 400s on a bare YYYY-MM-DD.
  // This is byte-for-byte the window `ThisWeeksShiftsCard` already queries, so
  // it is one shared cache entry rather than a second round-trip.
  const from = wallClockToUtcIso(today, '00:00', timeZone);
  const to = wallClockToUtcIso(addLocalDays(today, 14), '00:00', timeZone);
  const shifts = useShiftsRange(householdId, from, to);

  // The range route returns the WHOLE household's shifts — only hers count,
  // and only ones actually on someone's schedule.
  const shiftCountNext14Days = (shifts.data ?? []).filter(
    s => s.carer_id === myUserId && SCHEDULED_STATUS_SET.has(s.status)
  ).length;

  // The §8.1 welcome card marks itself dismissed in an effect on its first
  // render, so on that frame the key is still unset and this card stands
  // down. `joined_at` is what keeps a nanny who joined a year ago (empty
  // store) from suppressing this card forever — same guard `TodayScreen` uses.
  const myMembership = (members.data ?? []).find(m => m.user_id === myUserId);
  const joinedCardShowing =
    !!householdId &&
    myMembership !== undefined &&
    Date.now() - new Date(myMembership.joined_at).getTime() <
      JOINED_CARD_MAX_AGE_MS &&
    !isDismissed(`joinedHousehold:${householdId}`);

  const state = resolveNoWeekYet({
    householdId,
    isNanny: onboarding.role === SETUP_ROLES.NANNY,
    isPastMember: onboarding.isPastMember,
    householdIsLive: household?.state === HOUSEHOLD_STATES.LIVE,
    termsAgreed: termsGate.status === 'open',
    patternStatus: activePattern?.status ?? null,
    declinedByHer:
      activePattern?.status === SCHEDULE_PATTERN_STATUSES.DECLINED &&
      activePattern.carer_id === myUserId,
    shiftCountNext14Days,
    joinedCardShowing,
    weekStartISO: household
      ? getWeekStartISO(
          new Date(),
          household.timezone,
          household.week_starts_on
        )
      : '',
    isDismissed,
  });

  // Never flash the card in the gap before its own facts land, and never on a
  // FAILED read — the card claims nothing is scheduled, and saying that off a
  // 404 or a dropped connection is a lie. Same instinct as
  // `PendingScheduleCard`'s "invisible until we have BOTH the pattern and its
  // detail".
  if (
    state.kind === 'hidden' ||
    patterns.isLoading ||
    members.isLoading ||
    !shifts.isSuccess
  ) {
    return null;
  }

  const familyName = termsGate.familyName;

  return (
    <Card testID="today-no-week-yet-card" tone="default">
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-2">
          <IconChip tone="schedule" icon={CalendarClock} />
          <H4>
            {t(
              state.afterDecline
                ? 'todayCard.noWeekNannyTitleAfterDecline'
                : 'todayCard.noWeekNannyTitle',
              { familyName }
            )}
          </H4>
        </View>
        <Body className="text-muted-foreground">
          {t('todayCard.noWeekNannyBody')}
        </Body>
        <View className="flex-row gap-2">
          <Button
            testID="today-no-week-yet-availability"
            variant="ghost"
            onPress={() => router.push(AVAILABILITY_HREF)}
          >
            <Text className="text-foreground">
              {t('todayCard.noWeekNannyAvailabilityCta')}
            </Text>
          </Button>
          <Button
            testID="today-no-week-yet-hide"
            variant="ghost"
            onPress={() => dismiss(state.dismissKey)}
          >
            <Text className="text-foreground">
              {t('todayCard.noWeekNannyHide')}
            </Text>
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}
