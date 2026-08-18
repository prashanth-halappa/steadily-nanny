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
 * S7 (PER-CARER EVERYWHERE): this used to speak for `carers.data?.[0]` only
 * — a household's second nanny with no usual week, or a declined one, was
 * invisible. Every carer gets her own resolved state
 * (`resolveWeeklyHoursNotSet`); `groupWeeklyHoursNotSetCards`
 * (`WeeklyHoursNotSetCard.utils.ts`) then decides what renders: every
 * `setup` carer (no pattern at all / withdrawn / ended — the identical next
 * act) shares ONE combined card naming all of them, while `draft`/
 * `declined` carers each keep their own card (joining those would either
 * resume the wrong draft or hide which of two declines needs a look).
 * `ponytail:` the once-per-relationship "nanny joined" celebration frame
 * (`useMomentPeek`) still only suppresses the card for the FIRST carer in
 * the list — a second nanny's join moment overlapping this card is a rare
 * enough edge case not to worth a second snapshot hook here; upgrade if it
 * turns out to matter.
 *
 * Takes no props and renders `null` on an ordinary day, same shape as
 * `PendingScheduleCard`. Every per-carer decision lives in
 * `WeeklyHoursNotSetCard.utils`.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { HOUSEHOLD_STATES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useQueries } from '@tanstack/react-query';
import { type Href, useRouter } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { payArrangementApi } from '@/src/api/endpoints/payArrangements';
import { queryKeys } from '@/src/api/queryKeys';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { IconChip } from '@/src/components/ui/icon-chip';
import { Text } from '@/src/components/ui/text';
import { Body, H4 } from '@/src/components/ui/typography';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useUncoveredToday } from '@/src/domains/today/hooks/useUncoveredToday';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { isValidId, QUERY_TIMING } from '@/src/hooks/queries/utils';
import { formatNameList } from '@/src/lib/widgetSnapshot';
import {
  useCardDismissal,
  useTodayCardDismissalStore,
} from '@/src/store/todayCardDismissalStore';
import { useHouseholdCarers } from '../hooks/useHouseholdCarers';
import { resolveCarerName } from '../utils/memberDisplayName';
import { resolveActivePattern } from '../utils/patternPrecedence';
import {
  groupWeeklyHoursNotSetCards,
  resolveWeeklyHoursNotSet,
  type WeeklyHoursNotSetGroup,
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

export function WeeklyHoursNotSetCard() {
  const { t } = useTranslation('schedule');
  const router = useRouter();

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const household = activeHousehold.household;
  const householdId = household?.id ?? null;

  const { isDismissed, dismiss } = useCardDismissal();

  const carers = useHouseholdCarers(householdId);
  const carerList: HouseholdMember[] = carers.data ?? [];
  const firstCarer = carerList[0] ?? null;

  // S7: one pay-arrangement read per carer (docs/timeOff/usePaidFamilyCounts.ts
  // is the precedent for a dynamic-length `useQueries` list in this codebase)
  // — a fixed single `useCurrentPayArrangement` call can't cover N carers.
  const arrangementQueries = useQueries({
    queries: carerList.map(carer => ({
      queryKey: queryKeys.pay.current(householdId ?? undefined, carer.user_id),
      queryFn: () =>
        payArrangementApi.getCurrent(
          householdId as string,
          carer.user_id as string
        ),
      staleTime: QUERY_TIMING.STALE_1M,
      enabled: isValidId(householdId) && isValidId(carer.user_id),
    })),
  });

  const patterns = useSchedulePatterns(householdId);

  // `setup` means zero commitments, i.e. nothing for the builder to prefill
  // from. Only used for the SINGLE-carer setup card's body fork below —
  // ponytail: the combined multi-carer card skips the prefill distinction,
  // one generic body for all of them.
  const uncovered = useUncoveredToday(householdId, household?.timezone);

  const momentShowing = useMomentPeek(
    householdId &&
      firstCarer &&
      Date.now() - new Date(firstCarer.joined_at).getTime() <
        JOINED_CARD_MAX_AGE_MS
      ? `nannyJoined:${householdId}:${firstCarer.user_id}`
      : null
  );

  const isParentEditor = isParentEditorRole(onboarding.role);
  const householdIsLive = household?.state === HOUSEHOLD_STATES.LIVE;
  const patternsData = patterns.data ?? [];

  const entries = carerList.map((carer, index) => {
    const carerUserId = carer.user_id;
    const activePattern = resolveActivePattern(
      patternsData.filter(p => p.carer_id === carerUserId)
    );
    const state = resolveWeeklyHoursNotSet({
      householdId,
      carerUserId,
      isParentEditor,
      isPastMember: onboarding.isPastMember,
      householdIsLive,
      hasActiveNanny: carerList.length > 0,
      termsAgreed: !!arrangementQueries[index]?.data,
      patternStatus: activePattern?.status ?? null,
      momentShowing: carer.user_id === firstCarer?.user_id && momentShowing,
      isDismissed,
    });
    return { carer, carerUserId, activePattern, state };
  });

  // Both reads have to settle before ANY card can name a reason — guessing
  // shows "you haven't set a week" for a frame to a parent whose draft is
  // sitting right there.
  if (!patterns.isSuccess || !carers.isSuccess) {
    return null;
  }

  const groups = groupWeeklyHoursNotSetCards(
    entries.map(({ carerUserId, state }) => ({ carerUserId, state }))
  );
  if (groups.length === 0) {
    return null;
  }

  const entryByCarerId = new Map(entries.map(e => [e.carerUserId, e]));
  const nameFor = (carerUserId: string): string =>
    resolveCarerName(entryByCarerId.get(carerUserId)?.carer, '').trim() ||
    t('build.carerFallbackName');

  return (
    <>
      {groups.map(group => (
        <WeeklyHoursNotSetGroupCard
          key={
            group.kind === 'setup'
              ? `setup:${group.carerUserIds.join(',')}`
              : `${group.kind}:${group.carerUserId}`
          }
          group={group}
          nameFor={nameFor}
          activePatternFor={carerUserId =>
            entryByCarerId.get(carerUserId)?.activePattern ?? null
          }
          uncoveredIsSetup={uncovered.status === 'setup'}
          onDismiss={dismiss}
          onNavigate={href => router.push(href)}
        />
      ))}
    </>
  );
}

function WeeklyHoursNotSetGroupCard({
  group,
  nameFor,
  activePatternFor,
  uncoveredIsSetup,
  onDismiss,
  onNavigate,
}: {
  group: WeeklyHoursNotSetGroup;
  nameFor: (carerUserId: string) => string;
  activePatternFor: (
    carerUserId: string
  ) => ReturnType<typeof resolveActivePattern>;
  uncoveredIsSetup: boolean;
  onDismiss: (key: string) => void;
  onNavigate: (href: Href) => void;
}) {
  const { t } = useTranslation('schedule');

  if (group.kind === 'setup') {
    const names = group.carerUserIds.map(nameFor);
    const solo = names.length === 1;
    const title = solo
      ? t('todayCard.noWeekTitle', { name: names[0] })
      : t('todayCard.noWeekTitleMulti', { names: formatNameList(names) });
    const body = solo
      ? uncoveredIsSetup
        ? t('todayCard.noWeekBody', { name: names[0] })
        : t('todayCard.noWeekBodyPrefilled')
      : t('todayCard.noWeekBodyMulti');
    const cta = solo
      ? t('todayCard.noWeekCta', { name: names[0] })
      : t('todayCard.noWeekCtaMulti');

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
            onPress={() => onNavigate(BUILD_HREF)}
          >
            <Text className="text-primary-foreground font-medium">{cta}</Text>
          </Button>
          <Button
            testID="today-weekly-hours-not-set-adhoc"
            variant="ghost"
            onPress={() => {
              for (const key of group.dismissKeys) onDismiss(key);
              onNavigate(EXTRA_SHIFT_HREF);
            }}
          >
            <Text className="text-foreground">
              {t('todayCard.noWeekAdHoc')}
            </Text>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const name = nameFor(group.carerUserId);
  const activePattern = activePatternFor(group.carerUserId);
  const title =
    group.kind === 'draft'
      ? t('todayCard.noWeekDraftTitle', { name })
      : t('todayCard.noWeekDeclinedTitle', { name });
  const body =
    group.kind === 'draft'
      ? t('todayCard.noWeekDraftBody', { name })
      : t('todayCard.noWeekDeclinedBody');
  const cta =
    group.kind === 'draft'
      ? t('todayCard.noWeekDraftCta')
      : t('todayCard.noWeekDeclinedCta');
  // Resuming a draft reopens THAT pattern rather than starting a second one.
  const href =
    group.kind === 'draft' && activePattern
      ? (`${BUILD_HREF}?patternId=${activePattern.id}` as Href)
      : USUAL_WEEK_HREF;

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
          onPress={() => onNavigate(href)}
        >
          <Text className="text-primary-foreground font-medium">{cta}</Text>
        </Button>
      </CardContent>
    </Card>
  );
}
