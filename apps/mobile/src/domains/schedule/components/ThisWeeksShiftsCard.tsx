/**
 * @module domains/schedule/components/ThisWeeksShiftsCard
 *
 * Today "Next up" card — next two upcoming shifts so Today has a future tense.
 * Whose shift it is only earns row space in a 2+ carer household; a one-carer
 * home is told once, under the title, and the rows stay a clean date column.
 *
 * T4 (Wave 2-F): history/context on the bare ground, not its own lifted
 * card — a `Section` eyebrow + `rounded-row bg-card` rows carry the
 * surface instead. A row whose status isn't `confirmed` gets a `StatusPill`
 * (previously no row showed status at all, so a pending shift and a
 * confirmed one were pixel-identical).
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { SCHEDULE_PATTERN_STATUSES } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { SCHEDULED_SHIFT_STATUSES } from '@steadily-nanny/shared-types/uncoveredCare';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { ListGroup, ListRow } from '@/src/components/ui/list-group';
import { Section } from '@/src/components/ui/section';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Figure, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { resolveActivePattern } from '@/src/domains/schedule/utils/patternPrecedence';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { queryState } from '@/src/hooks/queries/queryState';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useSchedulePatterns } from '@/src/hooks/queries/useSchedulePatterns';
import { useShiftsRange } from '@/src/hooks/queries/useShiftsRange';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
import { formatInstantDisplay, wallClockToUtcIso } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { spacing } from '~/lib/design-tokens/spacing';

/** "Is this shift real on my schedule" — the card renders a `pending` row
 * with its own "Waiting" pill, so dropping pending would hide her own ask. */
const SCHEDULED_STATUS_SET = new Set<string>(SCHEDULED_SHIFT_STATUSES);

type ShiftStatusVariant = NonNullable<StatusPillProps['variant']>;

/** Each row renders the status it was given — no upstream promotion. */
const STATUS_TO_VARIANT: Record<Shift['status'], ShiftStatusVariant> = {
  draft: 'pending',
  pending: 'pending',
  confirmed: 'confirmed',
  declined: 'declined',
  cancelled: 'cancelled',
  completed: 'confirmed',
};

const STATUS_TO_LABEL_KEY: Record<Shift['status'], string> = {
  draft: 'shifts.statusDraft',
  pending: 'shifts.statusPending',
  confirmed: 'shifts.statusConfirmed',
  declined: 'shifts.statusDeclined',
  cancelled: 'shifts.statusCancelled',
  completed: 'shifts.statusCompleted',
};

function weekdayDow(dateISO: string): number {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getDay();
}

function formatShiftLine(
  shift: Shift,
  timeZone: string,
  t: (key: string) => string
): string {
  // Short weekday: the row now shares its width with a carer name, and
  // "Wednesday 6 Aug · 1:00–9:00 AM" is what pushed it onto two lines.
  const day = `${t(`weekdayShort.${weekdayDow(shift.local_date)}`)} ${formatDisplayDate(shift.local_date)}`;
  const start = formatInstantDisplay(shift.starts_at, timeZone);
  const end = formatInstantDisplay(shift.ends_at, timeZone);
  return `${day} · ${start}–${end}`;
}

/** First token only — the rows are narrow, and a surname adds no clarity. */
function firstNameOf(name: string): string {
  return name.split(' ')[0] ?? name;
}

export function ThisWeeksShiftsCard() {
  const { t } = useTranslation('schedule');
  const { t: tErrors } = useTranslation('errors');
  const router = useRouter();
  const currentUserId = useAuthStore(s => s.user?.id ?? null);
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const today = localDateInZone(timeZone);
  const from = wallClockToUtcIso(today, '00:00', timeZone);
  const to = wallClockToUtcIso(addLocalDays(today, 14), '00:00', timeZone);
  const shiftsQuery = useShiftsRange(active.householdId, from, to);
  const membersQuery = useHouseholdMembers(active.householdId);
  const patternsQuery = useSchedulePatterns(active.householdId);
  const onboarding = useIsOnboarded();

  const nextShifts = useMemo(() => {
    const now = Date.now();
    return (shiftsQuery.data ?? [])
      .filter(
        s =>
          SCHEDULED_STATUS_SET.has(s.status) &&
          new Date(s.ends_at).getTime() >= now
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 2);
  }, [shiftsQuery.data]);

  const carers = useMemo(
    () => (membersQuery.data ?? []).filter(m => m.role === 'nanny'),
    [membersQuery.data]
  );
  const carersByUserId = useMemo(
    () => new Map<string, HouseholdMember>(carers.map(m => [m.user_id, m])),
    [carers]
  );
  // Empty fallback: an unresolvable carer contributes no label at all rather
  // than a role word standing in for a name.
  const nameFor = (carerId: string | null) =>
    carerId ? resolveCarerName(carersByUserId.get(carerId), '') : '';
  // A solo carer viewing her own Today would just be reading her own name
  // back to herself — noise. Only useful to a viewer who ISN'T that carer
  // (the parent/helper view, where it identifies who is covering).
  const soleCarer = carers.length === 1 ? carers[0] : undefined;
  const soleCarerName =
    soleCarer && soleCarer.user_id !== currentUserId
      ? nameFor(soleCarer.user_id)
      : '';

  // An empty fortnight has two very different causes and the old copy said
  // the same thing for both. A schedule that is out for a reply or already
  // accepted is genuinely just quiet; one that was never sent is the reason
  // there is nothing to show, and this L4 block is what still says so once
  // the dismissible Today card is gone.
  const activePattern = useMemo(
    () => resolveActivePattern(patternsQuery.data ?? []),
    [patternsQuery.data]
  );
  const scheduleIsLive =
    activePattern?.status === SCHEDULE_PATTERN_STATUSES.PENDING ||
    activePattern?.status === SCHEDULE_PATTERN_STATUSES.ACCEPTED;
  const isNannyVoice = onboarding.role === SETUP_ROLES.NANNY;
  const familyName = active.household?.name ?? '';
  // Falls back to the plain line rather than naming nobody: "you haven't set
  // 's weekly hours" is worse than saying less.
  const noWeekNamed = isNannyVoice ? familyName : soleCarerName;
  const explainsMissingWeek = !scheduleIsLive && noWeekNamed !== '';
  const emptyLine = !explainsMissingWeek
    ? t('todayCard.nextUpEmpty')
    : isNannyVoice
      ? t('todayCard.nextUpEmptyNoWeekNanny', { familyName })
      : t('todayCard.nextUpEmptyNoWeek', { name: soleCarerName });
  // The parent's way out of this state is the builder, not the calendar she
  // is already looking at the summary of.
  const ctaHref =
    explainsMissingWeek && !isNannyVoice
      ? '/(private)/schedule/build'
      : '/(private)/schedule/shifts';

  // False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): this card had
  // NO loading or error gate at all — `emptyLine` above falls through
  // straight from `?? []`, so a still-loading or failed read used to
  // accuse the parent of never setting up a week she DID set up.
  const qs = queryState(shiftsQuery, membersQuery, patternsQuery);
  if (qs.status === 'loading') {
    return (
      <View testID="today-shifts-skeleton" className="gap-2">
        <SkeletonShimmer width="40%" height={12} />
        <SkeletonShimmer width="100%" height={36} />
      </View>
    );
  }
  if (qs.status === 'error') {
    return (
      <InlineRetry
        testID="today-shifts-retry"
        message={tErrors('network')}
        onRetry={qs.retry}
      />
    );
  }

  return (
    <View testID="today-shifts-card">
      <Section
        title={
          soleCarerName
            ? t('todayCard.nextUpTitleWithCarer', { name: soleCarerName })
            : t('todayCard.nextUpTitle')
        }
        // No `first`: "Next up" is a sub-section of "This week", so it takes
        // the full 32px above to read as its own group rather than as a
        // second heading 12px under the one before it.
        testID={soleCarerName ? 'today-next-up-carer' : undefined}
      >
        {nextShifts.length === 0 ? (
          <Small className="text-muted-foreground">{emptyLine}</Small>
        ) : (
          <ListGroup>
            {nextShifts.map(shift => {
              const carerName =
                carers.length > 1 ? firstNameOf(nameFor(shift.carer_id)) : '';
              return (
                <ListRow
                  key={shift.id}
                  testID={`today-next-up-${shift.id}`}
                  onPress={() =>
                    router.push(
                      `/(private)/schedule/shifts/${shift.id}` as Href
                    )
                  }
                  right={
                    <View className="flex-row items-center gap-2">
                      {shift.status !== 'confirmed' ? (
                        <StatusPill
                          testID={`today-next-up-status-${shift.id}`}
                          variant={STATUS_TO_VARIANT[shift.status]}
                          label={t(STATUS_TO_LABEL_KEY[shift.status])}
                        />
                      ) : null}
                      {carerName ? (
                        <Small
                          testID={`today-next-up-carer-${shift.id}`}
                          className="flex-shrink-0 text-muted-foreground"
                          style={{ maxWidth: '38%' }}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {carerName}
                        </Small>
                      ) : null}
                    </View>
                  }
                >
                  <Figure
                    testID={`today-next-up-line-${shift.id}`}
                    className="text-foreground"
                  >
                    {formatShiftLine(shift, timeZone, t)}
                  </Figure>
                </ListRow>
              );
            })}
          </ListGroup>
        )}
        <Pressable
          testID="today-shifts-cta"
          accessibilityRole="button"
          style={{
            minHeight: spacing.minTouchTarget,
            justifyContent: 'center',
          }}
          hitSlop={8}
          onPress={() => router.push(ctaHref as Href)}
        >
          <Small className="text-primary">{t('todayCard.viewCalendar')}</Small>
        </Pressable>
      </Section>
    </View>
  );
}
