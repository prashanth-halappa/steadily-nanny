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
import { AlertCircle, Plane } from 'lucide-react-native';
import { type ReactElement, type RefObject, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { cn } from '@/lib/utils';
import { Button } from '@/src/components/ui/button';
import { DayHeader } from '@/src/components/ui/day-header';
import { IconChip } from '@/src/components/ui/icon-chip';
import { LiveDot } from '@/src/components/ui/live-dot';
import { NowLine } from '@/src/components/ui/now-line';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Body, Figure, H4, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import {
  resolveCarerName,
  resolveMemberDisplayName,
} from '@/src/domains/schedule/utils/memberDisplayName';
import {
  formatShiftTime,
  localDateToWeekday,
  RESOLVED_STATUSES,
  shiftMinutes,
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
import { localDateInZone } from '@/src/lib/localDate';
import { utcIsoToWallClockHHMM } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

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
  /** Scrolls with the list instead of sitting frozen above it. */
  listHeader?: ReactElement;
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
      isToday: boolean;
    }
  | { type: 'now'; key: string }
  | { type: 'away'; key: string; localDate: string; message: string | null }
  | {
      type: 'uncovered';
      key: string;
      localDate: string;
      window: UncoveredWindowDisplay;
      highlighted: boolean;
    }
  | { type: 'shift'; key: string; shift: Shift };

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
  const elevation = useElevation();
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
  // `resolveCarerName` with an EMPTY fallback, not `resolveMemberDisplayName`:
  // the latter's last resort is a role phrase ('A nanny'), and the first-name
  // split turned that into "Ask A to start at 9:00". '' falls the CTA through
  // to the generic "Ask a nanny to cover" copy instead. Still the resolver, so
  // a carer's display-name override still wins, as on every other surface.
  const carerFirstName = singleCarer
    ? resolveCarerName(singleCarer, '').trim().split(/\s+/)[0]
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
      className="mx-5.5 mb-2 gap-3 rounded-row p-4"
      style={[
        elevation.cardProminent,
        {
          backgroundColor: colors.surfaceAttention,
          borderWidth: highlighted ? 2 : 0,
          borderColor: highlighted ? colors.warningStrong : undefined,
        },
      ]}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <IconChip tone="brand" icon={AlertCircle} />
          <H4 className="flex-1">{childName}</H4>
          <StatusPill variant="pending" label={t('cover.rowPill')} />
        </View>
        <Small className="text-muted-strong">
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
            {carerFirstName
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
  const removeCover = useRemoveParentCover();
  const isParentCover = shift.kind === SHIFT_KINDS.PARENT_COVER;
  const variant = STATUS_TO_VARIANT[shift.status];
  const isResolved = !isParentCover && RESOLVED_STATUSES.has(shift.status);
  // "Shift in progress" (L2) — a currently-confirmed shift whose window
  // straddles now. Computed once per render, not a ticking clock: the row
  // is close enough to live the moment any refetch/refocus re-renders it,
  // and a per-second timer here would be a stopwatch nobody asked for.
  const startMs = new Date(shift.starts_at).getTime();
  const endMs = new Date(shift.ends_at).getTime();
  const nowMs = Date.now();
  const isLive =
    !isParentCover &&
    shift.status === 'confirmed' &&
    startMs <= nowMs &&
    nowMs < endMs;
  // StatusPill only when the row isn't already a settled fact (L3 rule) —
  // a confirmed/completed row showing "Confirmed" on every single row is
  // the noise the pill was invented to avoid, not information.
  const showStatusPill =
    !isParentCover &&
    shift.status !== 'confirmed' &&
    shift.status !== 'completed';

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

  const TimeText = isResolved || isParentCover ? Body : Figure;

  const rowBody = (
    <>
      <View className="gap-1">
        <TimeText
          tabular
          className={
            isResolved || isParentCover ? 'text-muted-foreground' : undefined
          }
          style={isResolved ? { textDecorationLine: 'line-through' } : null}
        >
          {formatShiftTime(shift.starts_at, displayTimeZone)} –{' '}
          {formatShiftTime(shift.ends_at, displayTimeZone)}
        </TimeText>
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
          {isLive ? (
            <LiveDot testID={`schedule-shift-live-${shift.id}`} />
          ) : showStatusPill ? (
            <StatusPill
              testID={`schedule-shift-status-${shift.id}`}
              variant={variant}
              label={t(STATUS_TO_LABEL_KEY[shift.status])}
            />
          ) : null}
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

  const rowStyle = isLive
    ? [elevation.liveCard, { backgroundColor: elevation.liveCardBackground }]
    : isResolved
      ? undefined
      : elevation.row;

  return (
    <Pressable
      testID={`schedule-shift-${shift.id}`}
      accessibilityRole="button"
      onPress={() =>
        router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
      }
      className={cn(
        'relative mx-5.5 mb-2 flex-row items-center justify-between gap-2 rounded-row p-3',
        isResolved ? 'bg-muted' : isLive ? undefined : 'bg-card'
      )}
      style={rowStyle}
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
  listHeader,
}: AgendaViewProps) {
  const { t } = useTranslation('schedule');
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const currentUserId = useAuthStore(s => s.session?.user?.id ?? null);
  const membersQuery = useHouseholdMembers(householdId);
  const todayLocalDate = localDateInZone(displayTimeZone ?? householdTimeZone);
  // "You are here" in today's section. Computed once per render, not a
  // ticking clock: same precedent as LiveDot on a live shift row.
  const nowMs = Date.now();
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
        isToday: localDate === todayLocalDate,
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

      const isToday = localDate === todayLocalDate;
      let nowLinePlaced = false;
      const placeNowLine = () => {
        if (!isToday || nowLinePlaced) return;
        result.push({ type: 'now', key: 'now-line' });
        nowLinePlaced = true;
      };

      for (const row of timed) {
        if (row.at > nowMs) {
          placeNowLine();
        }
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
      placeNowLine();
    }
    return result;
  }, [
    shifts,
    timeOff,
    householdTimeZone,
    weekDates,
    uncoveredByDay,
    focusUncoveredKey,
    todayLocalDate,
    nowMs,
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
        ListHeaderComponent={listHeader}
        contentContainerStyle={{ paddingBottom: tabBarScrollPadding }}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return (
              <DayHeader
                label={item.label}
                localDate={item.localDate}
                isToday={item.isToday}
                total={
                  item.totalMinutes !== null
                    ? formatDuration(item.totalMinutes)
                    : null
                }
              />
            );
          }
          if (item.type === 'now') {
            return <NowLine testID="schedule-now-line" />;
          }
          if (item.type === 'away') {
            return (
              <View
                testID={`schedule-away-${item.localDate}`}
                className="mx-5.5 mb-2 flex-row items-center gap-3 rounded-row bg-muted px-3 py-2"
              >
                <IconChip tone="people" icon={Plane} />
                <View className="flex-1 gap-1">
                  <Body weight="medium" className="text-muted-foreground">
                    {t('shifts.awayBand')}
                  </Body>
                  {item.message ? (
                    <Small className="text-muted-foreground">
                      {item.message}
                    </Small>
                  ) : null}
                </View>
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
