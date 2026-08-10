/**
 * @module domains/schedule/components/AgendaView
 *
 * Calendar view 2a — day-by-day shift list, with Away bands for carer time off.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import {
  SHIFT_KINDS,
  type Shift,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { type Href, useRouter } from 'expo-router';
import { type RefObject, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { cn } from '@/lib/utils';
import { Button } from '@/src/components/ui/button';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Body, DayGroup, Figure, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import {
  formatShiftTime,
  localDateToWeekday,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { timeOffRowsForLocalDate } from '@/src/domains/schedule/utils/timeOffOverlap';
import {
  describeUncoveredCause,
  inferUncoveredCauseDetail,
  isFullDayUncovered,
  type UncoveredWindowDisplay,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import { commitmentBoundsOnLocalDate } from '@/src/domains/schedule/utils/uncoveredWeek';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useCreateParentCover } from '@/src/hooks/mutations/useCreateParentCover';
import { useRemoveParentCover } from '@/src/hooks/mutations/useRemoveParentCover';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { utcIsoToWallClockHHMM } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

// Row radius (`rounded-row`, tailwind.config.js) — no shared JS constant
// exists for it, so it's named here once for the accent-bar style, same
// approach as `card.tsx`'s CARD_RADIUS.
const ROW_RADIUS = 16;

/** Statuses that read as a resolved record, not a thing to act on (T4). */
const RESOLVED_STATUSES = new Set<Shift['status']>(['cancelled', 'declined']);
/** Statuses that still need a human — get the T3 accent bar. */
const NEEDS_ACTION_STATUSES = new Set<Shift['status']>(['pending', 'draft']);

type ShiftStatusVariant = NonNullable<StatusPillProps['variant']>;

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

interface AgendaViewProps {
  shifts: Shift[];
  displayTimeZone?: string | null;
  timeOff?: CarerTimeOff[];
  householdTimeZone?: string;
  /** Local calendar dates in the visible week — used for Away-only days. */
  weekDates?: string[];
  /** Used to resolve carer first names once the household has 2+ carers. */
  householdId?: string | null;
  uncoveredByDay?: Record<string, UncoveredWindowDisplay[]>;
  showUncoveredActions?: boolean;
  focusUncoveredKey?: string | null;
  commitments?: readonly ChildCommitment[];
  listRef?: RefObject<FlashListRef<AgendaItem> | null>;
}

export type AgendaItem =
  | {
      type: 'header';
      key: string;
      label: string;
      localDate: string;
      /** Sum of shifts that count as cover — excludes cancelled/declined.
       * Omitted (no total shown) when the day has no shifts at all. */
      totalMinutes: number | null;
    }
  | { type: 'away'; key: string; localDate: string; message: string | null }
  | {
      type: 'uncovered';
      key: string;
      localDate: string;
      window: UncoveredWindowDisplay;
      highlighted: boolean;
    }
  | { type: 'shift'; key: string; shift: Shift };

/** Whole-minute duration between two ISO instants, floored (never negative
 * with real data, but a display sum must not go negative). */
function shiftMinutes(shift: Shift): number {
  const minutes =
    (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) /
    60000;
  return Math.max(0, minutes);
}

function UncoveredRow({
  localDate,
  window,
  highlighted,
  householdId,
  displayTimeZone,
  childName,
  commitment,
  showActions,
  carers,
  shifts,
  currentUserId,
  membersByUserId,
  memberLabels,
}: {
  localDate: string;
  window: UncoveredWindowDisplay;
  highlighted: boolean;
  householdId: string;
  displayTimeZone?: string | null;
  childName: string;
  commitment?: ChildCommitment;
  showActions: boolean;
  carers: HouseholdMember[];
  shifts: readonly Shift[];
  currentUserId: string | null;
  membersByUserId: Map<string, HouseholdMember>;
  memberLabels: {
    you: string;
    someone: string;
    roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') => string;
  };
}) {
  const { t } = useTranslation('schedule');
  const { t: tToday } = useTranslation('today');
  const router = useRouter();
  const colors = useThemeColors();
  const createCover = useCreateParentCover();
  const key = uncoveredKey(window);

  const formattedStart = formatShiftTime(window.startsAt, displayTimeZone);
  const formattedEnd = formatShiftTime(window.endsAt, displayTimeZone);
  const timeLabel = (() => {
    if (commitment && displayTimeZone) {
      const { startUtc, endUtc } = commitmentBoundsOnLocalDate(
        commitment,
        localDate,
        displayTimeZone
      );
      if (isFullDayUncovered(window, startUtc, endUtc)) {
        return tToday('coverage.gap.allDay');
      }
    }
    return `${formattedStart}–${formattedEnd}`;
  })();

  const { cause, shift: causeShift } = inferUncoveredCauseDetail(
    window,
    shifts
  );
  const causeCarerName =
    causeShift?.carer_id && membersByUserId.has(causeShift.carer_id)
      ? resolveMemberDisplayName(
          causeShift.carer_id,
          currentUserId,
          membersByUserId,
          memberLabels
        )
      : null;
  const causeLabel = describeUncoveredCause({
    cause,
    shift: causeShift,
    carerName: causeCarerName,
    timeZone: displayTimeZone ?? 'UTC',
    t,
  });

  const singleCarer = carers.length === 1 ? carers[0] : null;
  const carerFirstName = singleCarer
    ? resolveMemberDisplayName(
        singleCarer.user_id,
        currentUserId,
        membersByUserId,
        memberLabels
      ).split(' ')[0]
    : '';

  const extraHref = (() => {
    const zone = displayTimeZone ?? 'UTC';
    const start = utcIsoToWallClockHHMM(window.startsAt, zone);
    const end = utcIsoToWallClockHHMM(window.endsAt, zone);
    const params = new URLSearchParams({
      date: localDate,
      start,
      end,
      childId: window.childId,
    });
    if (singleCarer?.user_id) {
      params.set('carerId', singleCarer.user_id);
    }
    return `/(private)/schedule/shifts/extra?${params.toString()}` as Href;
  })();

  return (
    <View
      testID={`schedule-uncovered-${key}`}
      className="mx-5.5 mb-2 gap-3 rounded-row p-3"
      style={{
        backgroundColor: colors.surfaceAttention,
        borderWidth: highlighted ? 2 : 0,
        borderColor: highlighted ? colors.warningStrong : undefined,
      }}
    >
      <View className="gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Body weight="medium">{childName}</Body>
          <StatusPill variant="pending" label={t('cover.rowPill')} />
        </View>
        <Small className="text-muted-foreground">
          {timeLabel} · {causeLabel}
        </Small>
      </View>
      {showActions ? (
        <View className="gap-2">
          <Button
            testID={`schedule-uncovered-ask-${key}`}
            size="sm"
            onPress={() => router.push(extraHref)}
          >
            {singleCarer
              ? t('cover.askToCover', {
                  carerName: carerFirstName,
                  start: formattedStart,
                })
              : t('cover.askSomeoneToCover', {
                  start: formattedStart,
                  end: formattedEnd,
                })}
          </Button>
          <Button
            testID={`schedule-uncovered-cover-${key}`}
            size="sm"
            variant="secondary"
            disabled={createCover.isPending}
            onPress={() => {
              if (!householdId) return;
              void createCover.mutateAsync({
                householdId,
                starts_at: window.startsAt,
                ends_at: window.endsAt,
                child_id: window.childId,
              });
            }}
          >
            {t('cover.iveGotIt')}
          </Button>
          <Pressable
            testID={`schedule-uncovered-hours-${key}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push('/settings/children' as Href)}
          >
            <Small className="text-primary" weight="medium">
              {t('cover.hoursWrong')}
            </Small>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ShiftRow({
  shift,
  displayTimeZone,
  carerName,
  currentUserId,
  membersByUserId,
  memberLabels,
  showParentCoverUndo,
}: {
  shift: Shift;
  displayTimeZone?: string | null;
  /** First name of the assigned carer — only passed once the household has
   * 2+ nanny/helper members (see `AgendaView`'s `showCarerNames`); a
   * single-carer household leaves this row exactly as it was before. */
  carerName?: string | null;
  currentUserId: string | null;
  membersByUserId: Map<
    string,
    NonNullable<ReturnType<typeof useHouseholdMembers>['data']>[number]
  >;
  memberLabels: {
    you: string;
    someone: string;
    roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') => string;
  };
  showParentCoverUndo?: boolean;
}) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const elevation = useElevation();
  const colors = useThemeColors();
  const removeCover = useRemoveParentCover();
  const isParentCover = shift.kind === SHIFT_KINDS.PARENT_COVER;
  const variant = STATUS_TO_VARIANT[shift.status];
  const isResolved = !isParentCover && RESOLVED_STATUSES.has(shift.status);
  const needsAction = !isParentCover && NEEDS_ACTION_STATUSES.has(shift.status);

  const parentCoverLabel = (() => {
    if (!isParentCover) return null;
    const parentId = shift.created_by;
    if (parentId && parentId === currentUserId) {
      return t('cover.parentCoveringRow');
    }
    const parentName = parentId
      ? resolveMemberDisplayName(
          parentId,
          currentUserId,
          membersByUserId,
          memberLabels
        ).split(' ')[0]
      : memberLabels.someone;
    return t('cover.parentCoveringBy', { parentName });
  })();

  const rowBody = (
    <>
      {needsAction ? (
        <View
          testID={`schedule-shift-accent-${shift.id}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            borderTopLeftRadius: ROW_RADIUS,
            borderBottomLeftRadius: ROW_RADIUS,
            backgroundColor: colors.warningStrong,
          }}
        />
      ) : null}
      <View className="gap-1">
        <Body
          tabular
          className={
            isResolved || isParentCover ? 'text-muted-foreground' : undefined
          }
          style={isResolved ? { textDecorationLine: 'line-through' } : null}
        >
          {formatShiftTime(shift.starts_at, displayTimeZone)} –{' '}
          {formatShiftTime(shift.ends_at, displayTimeZone)}
        </Body>
        {parentCoverLabel ? (
          <Small className="text-muted-foreground">{parentCoverLabel}</Small>
        ) : null}
      </View>
      {carerName ? (
        <Small
          testID={`schedule-shift-carer-${shift.id}`}
          className="flex-1 text-muted-foreground"
          numberOfLines={1}
        >
          {carerName}
        </Small>
      ) : null}
      {!isParentCover ? (
        <View className="flex-row items-center gap-2">
          {shift.is_short_notice ? (
            <StatusPill
              testID={`schedule-shift-short-notice-${shift.id}`}
              variant="short-notice"
              label={t('shifts.shortNotice')}
            />
          ) : null}
          <StatusPill
            testID={`schedule-shift-status-${shift.id}`}
            variant={variant}
            label={t(STATUS_TO_LABEL_KEY[shift.status])}
          />
        </View>
      ) : null}
    </>
  );

  if (isParentCover) {
    return (
      <View
        testID={`schedule-shift-${shift.id}`}
        accessibilityRole="text"
        className="relative mx-5.5 mb-2 flex-row items-center justify-between gap-2 rounded-row bg-muted p-3"
      >
        {rowBody}
        {showParentCoverUndo ? (
          <Pressable
            testID={`schedule-parent-cover-undo-${shift.id}`}
            accessibilityRole="button"
            hitSlop={8}
            disabled={removeCover.isPending}
            onPress={() => void removeCover.mutateAsync({ shiftId: shift.id })}
          >
            <Small className="text-primary" weight="medium">
              {t('cover.undoCovering')}
            </Small>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      testID={`schedule-shift-${shift.id}`}
      accessibilityRole="button"
      onPress={() =>
        router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
      }
      className={cn(
        'relative mx-5.5 mb-2 flex-row items-center justify-between gap-2 rounded-row p-3',
        isResolved ? 'bg-muted' : 'bg-card'
      )}
      style={isResolved ? undefined : elevation.row}
    >
      {rowBody}
    </Pressable>
  );
}

export function AgendaView({
  shifts,
  displayTimeZone,
  timeOff = [],
  householdTimeZone = 'UTC',
  weekDates = [],
  householdId,
  uncoveredByDay,
  showUncoveredActions = false,
  focusUncoveredKey = null,
  commitments = [],
  listRef,
}: AgendaViewProps) {
  const { t } = useTranslation('schedule');
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const currentUserId = useAuthStore(s => s.session?.user?.id ?? null);
  const membersQuery = useHouseholdMembers(householdId);
  const membersByUserId = useMemo(
    () =>
      new Map(
        (membersQuery.data ?? []).map(member => [member.user_id, member])
      ),
    [membersQuery.data]
  );
  const memberLabels = useMemo(
    () => ({
      you: t('detail.you'),
      someone: t('detail.someone'),
      roleFallback: (role: 'owner' | 'parent' | 'nanny' | 'helper') =>
        t(`detail.roleFallback.${role}`),
    }),
    [t]
  );
  // A single carer is unambiguous — no name needed on the row. 2+ active
  // nanny/helper members is when "who's covering this?" stops being
  // obvious at a glance.
  const showCarerNames =
    new Set(
      (membersQuery.data ?? [])
        .filter(member => member.role === 'nanny' || member.role === 'helper')
        .map(member => member.user_id)
    ).size >= 2;
  const carerFirstName = (carerId: string | null): string | undefined => {
    if (!carerId) return undefined;
    const fullName = resolveMemberDisplayName(
      carerId,
      currentUserId,
      membersByUserId,
      memberLabels
    );
    return fullName.split(' ')[0];
  };
  const childrenQuery = useChildren(householdId);
  const carersQuery = useHouseholdCarers(householdId);
  const childrenById = useMemo(
    () => new Map((childrenQuery.data ?? []).map(child => [child.id, child])),
    [childrenQuery.data]
  );
  const commitmentsById = useMemo(
    () => new Map(commitments.map(c => [c.id, c])),
    [commitments]
  );
  const items = useMemo(() => {
    const byDate = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const list = byDate.get(shift.local_date) ?? [];
      list.push(shift);
      byDate.set(shift.local_date, list);
    }

    const dates = new Set<string>([
      ...byDate.keys(),
      ...weekDates,
      ...(uncoveredByDay ? Object.keys(uncoveredByDay) : []),
    ]);
    dates.forEach(date => {
      if (
        timeOffRowsForLocalDate(timeOff, date, householdTimeZone).length > 0
      ) {
        dates.add(date);
      }
    });

    const result: AgendaItem[] = [];
    for (const localDate of [...dates].sort()) {
      const dayShifts = (byDate.get(localDate) ?? []).sort((a, b) =>
        a.starts_at.localeCompare(b.starts_at)
      );
      const totalMinutes =
        dayShifts.length === 0
          ? null
          : dayShifts
              .filter(shift => !RESOLVED_STATUSES.has(shift.status))
              .reduce((sum, shift) => sum + shiftMinutes(shift), 0);
      result.push({
        type: 'header',
        key: `header-${localDate}`,
        label: `${t(`weekday.${localDateToWeekday(localDate)}`)} · ${formatDisplayDate(localDate)}`,
        localDate,
        totalMinutes,
      });
      for (const row of timeOffRowsForLocalDate(
        timeOff,
        localDate,
        householdTimeZone
      )) {
        result.push({
          type: 'away',
          key: `away-${row.id}-${localDate}`,
          localDate,
          message: row.message,
        });
      }

      type TimedRow =
        | { kind: 'shift'; at: number; shift: Shift }
        | {
            kind: 'uncovered';
            at: number;
            window: UncoveredWindowDisplay;
            highlighted: boolean;
          };

      const timed: TimedRow[] = dayShifts.map(shift => ({
        kind: 'shift',
        at: Date.parse(shift.starts_at),
        shift,
      }));
      for (const window of uncoveredByDay?.[localDate] ?? []) {
        const key = uncoveredKey(window);
        timed.push({
          kind: 'uncovered',
          at: Date.parse(window.startsAt),
          window,
          highlighted: focusUncoveredKey === key,
        });
      }
      timed.sort((a, b) => a.at - b.at);

      for (const row of timed) {
        if (row.kind === 'shift') {
          result.push({ type: 'shift', key: row.shift.id, shift: row.shift });
        } else {
          result.push({
            type: 'uncovered',
            key: `uncovered-${uncoveredKey(row.window)}`,
            localDate,
            window: row.window,
            highlighted: row.highlighted,
          });
        }
      }
    }
    return result;
  }, [
    shifts,
    timeOff,
    householdTimeZone,
    weekDates,
    uncoveredByDay,
    focusUncoveredKey,
    t,
  ]);

  useEffect(() => {
    if (!focusUncoveredKey || !listRef?.current) {
      return;
    }
    const index = items.findIndex(
      item =>
        item.type === 'uncovered' &&
        uncoveredKey(item.window) === focusUncoveredKey
    );
    if (index >= 0) {
      listRef.current.scrollToIndex({ index, animated: false });
    }
  }, [focusUncoveredKey, items, listRef]);

  return (
    <View testID="calendar-agenda-view" style={{ flex: 1 }}>
      <FlashList
        ref={listRef}
        testID="schedule-shifts-list"
        data={items}
        keyExtractor={item => item.key}
        getItemType={item => item.type}
        contentContainerStyle={{ paddingBottom: tabBarScrollPadding }}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return (
              <View className="flex-row items-baseline justify-between px-5.5 pt-4 pb-1">
                <DayGroup>{item.label}</DayGroup>
                {item.totalMinutes !== null ? (
                  <Figure testID={`schedule-day-total-${item.localDate}`}>
                    {formatDuration(item.totalMinutes)}
                  </Figure>
                ) : null}
              </View>
            );
          }
          if (item.type === 'away') {
            return (
              <View
                testID={`schedule-away-${item.localDate}`}
                className="mx-5.5 mb-2 rounded-row bg-muted px-3 py-2"
              >
                <Body weight="medium" className="text-muted-foreground">
                  {t('shifts.awayBand')}
                </Body>
                {item.message ? (
                  <Small className="text-muted-foreground">
                    {item.message}
                  </Small>
                ) : null}
              </View>
            );
          }
          if (item.type === 'uncovered') {
            if (!householdId) {
              return null;
            }
            const child = childrenById.get(item.window.childId);
            return (
              <UncoveredRow
                localDate={item.localDate}
                window={item.window}
                highlighted={item.highlighted}
                householdId={householdId}
                displayTimeZone={displayTimeZone}
                childName={child?.name ?? ''}
                commitment={commitmentsById.get(item.window.commitmentId)}
                showActions={showUncoveredActions}
                carers={carersQuery.data ?? []}
                shifts={shifts}
                currentUserId={currentUserId}
                membersByUserId={membersByUserId}
                memberLabels={memberLabels}
              />
            );
          }
          if (item.type !== 'shift') {
            return null;
          }
          return (
            <ShiftRow
              shift={item.shift}
              displayTimeZone={displayTimeZone}
              carerName={
                showCarerNames ? carerFirstName(item.shift.carer_id) : null
              }
              currentUserId={currentUserId}
              membersByUserId={membersByUserId}
              memberLabels={memberLabels}
              showParentCoverUndo={
                showUncoveredActions &&
                item.shift.kind === SHIFT_KINDS.PARENT_COVER
              }
            />
          );
        }}
      />
    </View>
  );
}
