/**
 * @module domains/schedule/components/WeeklyHoursNotSetCard
 *
 * A nanny accepted the invite, both sides agreed the pay terms — and nothing
 * is scheduled. Nobody ever told the parent that sending a usual week is the
 * next thing, so the relationship stalls with two people waiting on each
 * other. This card is the parent-side mirror of `NoWeekYetCard`: it says the
 * week is missing and hands her the builder.
 *
 * IT IS CHEAP TO SAY YES TO. The builder prefills from the care hours typed
 * during setup and skips straight to Review, so `noWeekBodyPrefilled` is an
 * honest promise whenever any commitment exists — `useUncoveredToday` reports
 * `setup` iff there are none, which is the whole prefilled-vs-not test.
 *
 * NO "Not now". There are exactly two real answers to "when does she work?"
 * — a repeating week, or days booked as they come — and both are doors.
 * The ghost button is the second answer: it records the dismissal AND opens
 * the one-off shift screen in the same tap, so a household that genuinely
 * works ad hoc gets the right tool instead of a card it has to fight off.
 *
 * A FEED CARD, NEVER A SLOT OCCUPANT. Nothing is blocked and nobody is
 * waiting on a reply, so this touches neither `attentionOwner.ts` nor
 * `slotOccupant.ts` — per their module docs, a rung that displaces nothing
 * is not a rung.
 *
 * Takes no props and renders `null` on an ordinary day, same shape as
 * `PendingScheduleCard`. Every decision lives in
 * `WeeklyHoursNotSetCard.utils`.
 */
import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Body, H4 } from '@/src/components/ui/typography';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useUncoveredToday } from '@/src/domains/today/hooks/useUncoveredToday';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import {
  useCardDismissal,
  useTodayCardDismissalStore,
} from '@/src/store/todayCardDismissalStore';
import { useHouseholdCarers } from '../hooks/useHouseholdCarers';
import { resolveCarerName } from '../utils/memberDisplayName';
import { resolveActivePattern } from '../utils/patternPrecedence';
import {
  resolveWeeklyHoursNotSet,
  type WeeklyHoursNotSetVariant,
} from './WeeklyHoursNotSetCard.utils';

const EXTRA_SHIFT_HREF = '/(private)/schedule/shifts/extra' as Href;
const USUAL_WEEK_HREF = '/(private)/schedule/usual-week' as Href;
const BUILD_HREF = '/(private)/schedule/build' as Href;

/** Mirrors `TodayScreen`'s window for its §8.1 joined card (module-private there). */
const JOINED_CARD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "Is the nanny-joined moment on screen this mount?" — WITHOUT consuming it.
 *
 * `useMomentOnce` persists the key in an effect on its first render, so a
 * live `isDismissed` read would flip to false one frame in and pop this card
 * up underneath a celebration that is still on screen for the rest of the
 * mount. Snapshotting mirrors `useMomentOnce`'s own semantics: both
 * components' state initialisers run in the same commit, before either
 * effect, so they always agree. (`NoWeekYetCard` reads its joined card live
 * on purpose — that card unmounts on the same frame it marks itself, this
 * one does not.)
 */
function useMomentPeek(key: string | null): boolean {
  // The one place the NON-reactive read is the right one: this must not
  // re-render when the moment marks itself seen mid-mount, which is the whole
  // point of snapshotting. Do not swap this for `useCardDismissal`.
  const isDismissed = useTodayCardDismissalStore(s => s.isDismissed);
  const [alreadySeen, setAlreadySeen] = useState(
    () => key !== null && isDismissed(key)
  );
  const decidedRef = useRef(key !== null);

  // A null key on the first paint (members still loading) must not freeze the
  // answer for the whole mount — adopt the first real key once.
  if (key !== null && !decidedRef.current) {
    decidedRef.current = true;
    const next = isDismissed(key);
    if (next !== alreadySeen) setAlreadySeen(next);
  }

  return key !== null && !alreadySeen;
}

const ROUTE_BY_VARIANT: Record<WeeklyHoursNotSetVariant, Href> = {
  setup: BUILD_HREF,
  draft: BUILD_HREF,
  declined: USUAL_WEEK_HREF,
};

export function WeeklyHoursNotSetCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  const householdId = household?.id ?? null;

  const { isDismissed, dismiss } = useCardDismissal();

  const carers = useHouseholdCarers(householdId);
  // Wave 1 households have exactly one nanny. With two, this card speaks for
  // the first — the copy is per-relationship and a second card would be two
  // to-dos about the same missing thing.
  // ponytail: one carer, upgrade to per-carer cards if multi-nanny lands.
  const carer = carers.data?.[0] ?? null;
  const carerUserId = carer?.user_id ?? null;

  const arrangement = useCurrentPayArrangement(householdId, carerUserId);

  const patterns = useSchedulePatterns(householdId);
  // Only patterns addressed to HER: a week sent to the other nanny says
  // nothing about this relationship, and a carer-less sketch is addressed to
  // nobody.
  const activePattern = resolveActivePattern(
    (patterns.data ?? []).filter(p => p.carer_id === carerUserId)
  );

  // `setup` means zero commitments, i.e. nothing for the builder to prefill
  // from. Every other state means the care-hours seed will land.
  const uncovered = useUncoveredToday(householdId, household?.timezone);

  const momentShowing = useMomentPeek(
    householdId &&
      carerUserId &&
      carer &&
      Date.now() - new Date(carer.joined_at).getTime() < JOINED_CARD_MAX_AGE_MS
      ? `nannyJoined:${householdId}:${carerUserId}`
      : null
  );

  const state = resolveWeeklyHoursNotSet({
    householdId,
    carerUserId,
    isParentEditor: isParentEditorRole(onboarding.role),
    isPastMember: onboarding.isPastMember,
    householdIsLive: household?.state === HOUSEHOLD_STATES.LIVE,
    hasActiveNanny: (carers.data ?? []).length > 0,
    termsAgreed: !!arrangement.data,
    patternStatus: activePattern?.status ?? null,
    momentShowing,
    isDismissed,
  });

  // Both reads have to settle before the card can name a reason — guessing
  // shows "you haven't set a week" for a frame to a parent whose draft is
  // sitting right there.
  if (state.kind === 'hidden' || !patterns.isSuccess || !carers.isSuccess) {
    return null;
  }

  const name =
    resolveCarerName(carer, '').trim().split(/\s+/)[0] ||
    t('build.carerFallbackName');

  // Literal `t()` per branch — a ternary inside `t(...)` hides the other key
  // from the locale-key guard.
  const title =
    state.variant === 'draft'
      ? t('todayCard.noWeekDraftTitle', { name })
      : state.variant === 'declined'
        ? t('todayCard.noWeekDeclinedTitle', { name })
        : t('todayCard.noWeekTitle', { name });

  const body =
    state.variant === 'draft'
      ? t('todayCard.noWeekDraftBody')
      : state.variant === 'declined'
        ? t('todayCard.noWeekDeclinedBody')
        : uncovered.status === 'setup'
          ? t('todayCard.noWeekBody', { name })
          : t('todayCard.noWeekBodyPrefilled');

  const cta =
    state.variant === 'draft'
      ? t('todayCard.noWeekDraftCta')
      : state.variant === 'declined'
        ? t('todayCard.noWeekDeclinedCta')
        : t('todayCard.noWeekCta');

  // Resuming a draft reopens THAT pattern rather than starting a second one.
  const href =
    state.variant === 'draft' && activePattern
      ? (`${BUILD_HREF}?patternId=${activePattern.id}` as Href)
      : ROUTE_BY_VARIANT[state.variant];

  return (
    <Card tone="default" testID="today-weekly-hours-not-set-card">
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-2">
          <IconChip tone="schedule" icon={CalendarDays} />
          <H4>{title}</H4>
        </View>
        <Body className="text-muted-foreground">{body}</Body>
        <Button
          testID="today-weekly-hours-not-set-cta"
          variant="default"
          onPress={() => router.push(href)}
        >
          <Text className="text-primary-foreground font-medium">{cta}</Text>
        </Button>
        {state.variant === 'setup' ? (
          <Button
            testID="today-weekly-hours-not-set-adhoc"
            variant="ghost"
            onPress={() => {
              dismiss(state.dismissKey);
              router.push(EXTRA_SHIFT_HREF);
            }}
          >
            <Text className="text-foreground">
              {t('todayCard.noWeekAdHoc')}
            </Text>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
