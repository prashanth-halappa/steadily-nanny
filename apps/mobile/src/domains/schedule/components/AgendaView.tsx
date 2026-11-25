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
import { AlertCircle, HelpCircle, Plane } from 'lucide-react-native';
import {
  type ReactElement,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
import { Button } from '@/src/components/ui/button';
import { DayHeader } from '@/src/components/ui/day-header';
import { IconChip } from '@/src/components/ui/icon-chip';
import { LoadingDots } from '@/src/components/ui/loading-dots';
import { NowLine } from '@/src/components/ui/now-line';
import { StatusPill } from '@/src/components/ui/status-pill';
import {
  Body,
  Caption,
  H4,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import {
  resolveCarerName,
  resolveMemberDisplayName,
} from '@/src/domains/schedule/utils/memberDisplayName';
import {
  formatShiftTime,
  isOutstandingCoverAsk,
  localDateToWeekday,
  totalCoveringMinutes,
} from '@/src/domains/schedule/utils/shiftGrouping';
import {
  shiftOverlapsTimeOff,
  timeOffRowsForLocalDate,
} from '@/src/domains/schedule/utils/timeOffOverlap';
import {
  type AwaitingPattern,
  describeUncoveredCause,
  inferUncoveredCauseDetail,
  overlappingShifts,
  type UncoveredWindowDisplay,
  type WindowSlice,
  windowSlices,
} from '@/src/domains/schedule/utils/uncoveredDisplay';
import { formatDuration } from '@/src/domains/timesheet/utils/duration';
import {
  formatDisplayDate,
  formatWeekRangeLabel,
} from '@/src/domains/timesheet/utils/week';
import { useCreateParentCover } from '@/src/hooks/mutations/useCreateParentCover';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { localDateInZone } from '@/src/lib/localDate';
import { utcIsoToWallClockHHMM } from '@/src/lib/wallClock';
import { useAuthStore } from '@/src/store/auth';
import { useElevation } from '~/lib/design-tokens/elevation';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import { PendingAskActions } from './PendingAskActions';
import { ShiftRow } from './ShiftRow';

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
  /** Slices of uncovered care a pending pattern covers, clipped to its blocks
   * — a quiet Pending row with no actions. One that also overlaps a pending
   * shift adds no row; that shift row already says Pending. */
  awaitingByDay?: Record<string, UncoveredWindowDisplay[]>;
  showUncoveredActions?: boolean;
  focusUncoveredKey?: string | null;
  listRef?: RefObject<FlashListRef<AgendaItem> | null>;
  /** Scrolls with the list instead of sitting frozen above it. */
  listHeader?: ReactElement;
  /** Ids of shifts someone is clocked into right now — threaded straight to
   * `ShiftRow`, resolved once per screen rather than queried per row. */
  runningShiftIds?: ReadonlySet<string>;
  /** Continuous Agenda: the loaded week pages, oldest first. Replaces
   * `weekDates`; each page renders its own loading / error / empty state, so
   * an unloaded range never reads as "nothing on". */
  weeks?: AgendaWeek[];
  /** With `weeks`: `listHeader` rides as an ITEM just above this week rather
   * than as the list header, so earlier pages load above it while
   * maintainVisibleContentPosition holds the reader in place. */
  heroWeekStart?: string;
  /** Called when the reader nears the top / bottom; omit at the range cap. */
  onLoadEarlier?: () => void;
  onLoadLater?: () => void;
  /** Household care hours + pending pattern: lets a remainder card name the
   * rest of its window (addendum A1). Omitted → cards render as before. */
  commitments?: readonly ChildCommitment[];
  pendingPattern?: SlicePattern | null;
  /** Bump to scroll back to the NOW block (the pinned "Today" jump). */
  nowRequest?: number;
}

type SlicePattern = AwaitingPattern & { carer_id?: string | null };

export type AgendaWeek = {
  weekStart: string;
  dates: string[];
  status: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
};

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
      /** Earliest-in-time uncovered row in the visible week — the one that
       * keeps the loud (surfaceAttention + cardProminent) treatment. Every
       * other uncovered row is the same fact restated, so it drops to a
       * quiet white card instead (docs/design/01-LAWS.md Rule E — L1
       * attaches to the group, not to every item in it). */
      isPrimary: boolean;
    }
  | {
      type: 'awaiting';
      key: string;
      localDate: string;
      window: UncoveredWindowDisplay;
    }
  | { type: 'shift'; key: string; shift: Shift }
  | { type: 'hero'; key: string }
  | { type: 'weekLabel'; key: string; weekStart: string; label: string }
  // One item per non-ready / empty week, and a zero-height end marker for a
  // filled one, all keyed `week-<start>`: the key survives loading -> loaded,
  // so a reader parked on a loading page above stays put as it fills in.
  | {
      type: 'weekStatus';
      key: string;
      weekStart: string;
      label: string;
      status: 'loading' | 'error' | 'empty';
      onRetry?: () => void;
    }
  | { type: 'weekEnd'; key: string };

function UncoveredRow({
  localDate,
  window,
  highlighted,
  isPrimary,
  nowMs,
  householdId,
  displayTimeZone,
  childName,
  showActions,
  carers,
  shifts,
  currentUserId,
  membersByUserId,
  memberLabels,
  closedReason,
  awaiting = false,
  commitments,
  pendingPattern,
}: {
  localDate: string;
  window: UncoveredWindowDisplay;
  highlighted: boolean;
  isPrimary: boolean;
  /** Same `Date.now()` the row's "now" line uses — one reference per
   * render, not a per-row clock read. Feeds B1's 72-hour loudness horizon. */
  nowMs: number;
  householdId: string;
  displayTimeZone?: string | null;
  childName: string;
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
  /** From `useCanWriteHousehold`, computed once in `AgendaView` — the
   * closed-household reason, or null when the reader may still act. */
  closedReason: string | null;
  /** Asked, not yet answered: Pending pill, no cause line, no actions (the
   * pattern banner already carries withdraw/edit). */
  awaiting?: boolean;
  /** Household care hours + the pending pattern, for the remainder card's
   * "The rest of …" section (addendum A1). Absent → no section. */
  commitments?: readonly ChildCommitment[];
  pendingPattern?: SlicePattern | null;
}) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const colors = useThemeColors();
  const elevation = useElevation();
  const createCover = useCreateParentCover();
  const key = uncoveredKey(window);

  // B1 — loudness earns its place from the SAME 72-hour "act now" horizon
  // the `uncovered_care_detected` push already uses (docs/12-NEED-COVERAGE.md
  // §5), not from being earliest in a Monday's list order. A Friday gap on
  // a Monday morning is real, but it isn't an alarm yet.
  const isLoud =
    isPrimary && Date.parse(window.startsAt) - nowMs < 72 * 3600_000;

  const formattedStart = formatShiftTime(window.startsAt, displayTimeZone);
  const formattedEnd = formatShiftTime(window.endsAt, displayTimeZone);
  // Always the real hours: "all day" fired whenever the whole NEED window
  // was open, so 07:00–13:00 care hours read as the whole day.
  const timeLabel = `${formattedStart}–${formattedEnd}`;

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

  // C — "I'm covering this" cannot flatly say nobody hears about it:
  // `shiftCommandService.notifyCarersParentCover` pushes a carer whose
  // pending/confirmed shift the same local date starts exactly when this
  // cover window ends ("Your day starts {{time}} as planned"). Mirrors that
  // condition exactly rather than guessing — if the two drift, the app
  // states the wrong recipient, which is worse than stating none.
  const adjacentCarerShift = shifts.find(
    s =>
      s.carer_id &&
      (s.status === 'pending' || s.status === 'confirmed') &&
      s.starts_at === window.endsAt
  );
  const adjacentCarerName = adjacentCarerShift?.carer_id
    ? resolveMemberDisplayName(
        adjacentCarerShift.carer_id,
        currentUserId,
        membersByUserId,
        memberLabels
      )
    : null;
  // Only the one push that is specific to THIS card earns a caption; the
  // generic "tells no one" lives once in the explainer (`cover.explainer`).
  const coverRecipientLine = adjacentCarerName
    ? t('recipient.parentCoverAdjacent', {
        name: adjacentCarerName,
        time: formatShiftTime(window.endsAt, displayTimeZone),
      })
    : null;

  const askLabel = carerFirstName
    ? t('cover.askToCover', {
        carerName: carerFirstName,
        start: formattedStart,
      })
    : t('cover.askSomeoneToCover', {
        start: formattedStart,
        end: formattedEnd,
      });
  // Quiet half-width buttons cannot fit the long time-range labels; the H4
  // above already states child + window, so drop the range here only.
  const askLabelQuiet = carerFirstName
    ? t('cover.askToCoverShort', { carerName: carerFirstName })
    : t('cover.askSomeoneToCoverShort');

  const handleCoverPress = () => {
    if (!householdId) return;
    void createCover.mutateAsync({
      householdId,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      child_id: window.childId,
    });
  };

  // Addendum A1: the remainder card names what the rest of its need window
  // is — asked, booked, parent-covered. Context only: the remainder keeps
  // its own pill, tier, actions and count (S1).
  const zone = displayTimeZone ?? 'UTC';
  const rest = useMemo(
    () =>
      awaiting || !commitments
        ? null
        : windowSlices({
            remainder: window,
            commitments,
            shifts: shifts.filter(s => s.local_date === localDate),
            pendingPattern: pendingPattern ?? null,
            localDate,
            timezone: zone,
          }),
    [awaiting, commitments, window, shifts, pendingPattern, localDate, zone]
  );
  const sliceCarerName = (carerId: string | null) => {
    const member = carerId
      ? carers.find(c => c.user_id === carerId)
      : undefined;
    return member ? resolveCarerName(member, '').trim().split(/\s+/)[0] : '';
  };
  const sliceText = (slice: WindowSlice) => {
    const range = {
      start: formatShiftTime(slice.startsAt, displayTimeZone),
      end: formatShiftTime(slice.endsAt, displayTimeZone),
    };
    if (slice.kind === 'parentCover') {
      return t('cover.slice.parentCover', range);
    }
    const carerName = sliceCarerName(slice.carerId);
    if (slice.kind === 'pending') {
      return carerName
        ? t('cover.slice.asked', { ...range, carerName })
        : t('cover.slice.askedNoName', range);
    }
    return carerName
      ? t('cover.slice.booked', { ...range, carerName })
      : t('cover.slice.bookedNoName', range);
  };

  const recipientToneClass = isLoud
    ? 'text-muted-strong'
    : 'text-muted-foreground';

  return (
    <View
      testID={`schedule-${awaiting ? 'awaiting' : 'uncovered'}-${key}`}
      className="mx-5.5 mb-2 gap-3 rounded-row p-4"
      style={[
        isLoud ? elevation.cardProminent : elevation.row,
        {
          // The quiet tier is a WHITE card, not a paler amber: `pill.warning`
          // (#F1E5D5) and `surfaceAttention` (#F4EADC) differ by ~0.02 of a
          // contrast ratio, so a "quieter" amber row was indistinguishable
          // from the loud one on device — five gaps still read as five
          // alarms. White ground + the amber icon chip and pill carrying the
          // state is the same information in a rung the eye can actually
          // separate (and the pill is invisible on an amber ground).
          backgroundColor: isLoud ? colors.surfaceAttention : colors.card,
          borderWidth: highlighted ? 2 : 0,
          borderColor: highlighted ? colors.warningStrong : undefined,
        },
      ]}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <IconChip
            tone={isLoud ? 'brand' : 'schedule'}
            icon={isLoud ? AlertCircle : HelpCircle}
          />
          <H4 className="flex-1">
            {childName} · {timeLabel}
          </H4>
          {awaiting ? (
            <StatusPill variant="pending" label={t('cover.rowPillPending')} />
          ) : (
            <StatusPill variant="uncovered" label={t('cover.rowPill')} />
          )}
        </View>
        {/* The generic cause ("you set these as care hours, nobody's booked")
            is said once, in the explainer above the first card. */}
        {awaiting || cause === 'nothingScheduled' ? null : (
          <Small
            className={isLoud ? 'text-muted-strong' : 'text-muted-foreground'}
          >
            {causeLabel}
          </Small>
        )}
        {/* Layout spec §2b: an asked-but-unanswered usual week can't be
            edited in place (the server has no pending→draft), so the card
            names what it's part of and points at the screen that owns
            "Withdraw" / "Change it". Parent-voiced ("you sent"), so only for
            a viewer who can act. */}
        {awaiting && showActions ? (
          <Small
            testID={`schedule-awaiting-${key}-line`}
            className="text-muted-foreground"
          >
            {t('cover.awaitingLine')}
          </Small>
        ) : null}
      </View>
      {rest && rest.slices.length > 0 ? (
        <View testID={`schedule-uncovered-${key}-slices`} className="gap-1">
          <MetadataLabel className="text-muted-foreground">
            {t('cover.slice.heading', {
              start: formatShiftTime(rest.needStart, displayTimeZone),
              end: formatShiftTime(rest.needEnd, displayTimeZone),
            })}
          </MetadataLabel>
          {rest.slices.map((slice, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: slices are positional, time-ordered within one window
              key={i}
              testID={`schedule-uncovered-${key}-slice-${i}`}
              className="flex-row items-center gap-2"
            >
              {slice.kind === 'parentCover' ? null : (
                <StatusPill
                  testID={`schedule-uncovered-${key}-slice-${i}-pill`}
                  variant={slice.kind === 'pending' ? 'pending' : 'confirmed'}
                  label={
                    slice.kind === 'pending'
                      ? t('cover.rowPillPending')
                      : t('shifts.statusConfirmed')
                  }
                />
              )}
              <Small
                testID={`schedule-uncovered-${key}-slice-${i}-text`}
                className="flex-1 text-muted-foreground"
                tabular
              >
                {sliceText(slice)}
              </Small>
            </View>
          ))}
        </View>
      ) : null}
      {awaiting && showActions ? (
        <Button
          testID={`schedule-awaiting-${key}-see`}
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() => router.push('/(private)/schedule/usual-week' as Href)}
        >
          {t('cover.awaitingSee')}
        </Button>
      ) : null}
      {showActions && !awaiting ? (
        isLoud ? (
          <View className="gap-2">
            <RestrictedActionButton
              testID={`schedule-uncovered-ask-${key}`}
              size="sm"
              label={askLabel}
              reason={closedReason}
              onPress={() => router.push(extraHref)}
            />
            <View className="gap-1">
              <RestrictedActionButton
                testID={`schedule-uncovered-cover-${key}`}
                size="sm"
                variant="secondary"
                label={t('cover.iveGotIt')}
                reason={closedReason}
                disabled={createCover.isPending}
                onPress={handleCoverPress}
              />
              {coverRecipientLine ? (
                <Caption
                  testID={`schedule-uncovered-cover-${key}-recipient`}
                  className={recipientToneClass}
                >
                  {coverRecipientLine}
                </Caption>
              ) : null}
            </View>
          </View>
        ) : (
          // B2 — the quiet tier's two REAL choices side by side, both
          // secondary — the H4 above already names the child and time, so
          // there is no full-width alarm button to earn its own row.
          <View className="flex-row gap-2">
            <View className="flex-1">
              <RestrictedActionButton
                testID={`schedule-uncovered-ask-${key}`}
                size="sm"
                variant="secondary"
                label={askLabelQuiet}
                reason={closedReason}
                onPress={() => router.push(extraHref)}
              />
            </View>
            <View className="flex-1 gap-1">
              <RestrictedActionButton
                testID={`schedule-uncovered-cover-${key}`}
                size="sm"
                variant="secondary"
                label={t('cover.iveGotIt')}
                reason={closedReason}
                disabled={createCover.isPending}
                onPress={handleCoverPress}
              />
              {coverRecipientLine ? (
                <Caption
                  testID={`schedule-uncovered-cover-${key}-recipient`}
                  className={recipientToneClass}
                >
                  {coverRecipientLine}
                </Caption>
              ) : null}
            </View>
          </View>
        )
      ) : null}
    </View>
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
  awaitingByDay,
  showUncoveredActions = false,
  focusUncoveredKey = null,
  listRef,
  listHeader,
  runningShiftIds,
  weeks,
  heroWeekStart,
  onLoadEarlier,
  onLoadLater,
  nowRequest = 0,
  commitments,
  pendingPattern,
}: AgendaViewProps) {
  const router = useRouter();
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  // Computed ONCE per screen, not per row/shift — the closed-household gate
  // is orthogonal to `showUncoveredActions`'s existing role-based hide/show
  // (left untouched): a role that may act still sees its buttons, now
  // disabled+reasoned instead of active, once the household itself closes.
  // Fails toward WAIT: stays null while unknown, so nothing flickers
  // disabled while the read settles.
  const canWriteHousehold = useCanWriteHousehold(householdId);
  const closedReason =
    !canWriteHousehold.isLoading && !canWriteHousehold.canWrite
      ? tCommon('householdClosedReason')
      : null;
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const { refreshing, onRefresh } = usePullToRefresh();
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
  // obvious at a glance. Active membership alone UNDERCOUNTS the moment one
  // carer deletes her account: her `household_members` row is destroyed
  // (058/061), so she vanishes from `membersQuery.data` even though her
  // COMPLETED shifts are still on screen — a shift only reaches `completed`
  // once someone actually worked it, unlike a merely `confirmed`-but-still-
  // unassigned one (`carer_id: null` there stays a legitimate "no one yet",
  // which must keep rendering blank rather than lying about who's covering
  // it — see the sibling test). `shifts` carries no `carer_display_name`
  // snapshot the way `time_entries` does, so a completed+unassigned row is
  // read as departed-carer evidence, not as "nobody worked this".
  const activeCarerIds = new Set(
    (membersQuery.data ?? [])
      .filter(member => member.role === 'nanny' || member.role === 'helper')
      .map(member => member.user_id)
  );
  const hasOrphanedCarerShift = shifts.some(
    shift => shift.carer_id === null && shift.status === 'completed'
  );
  const showCarerNames = activeCarerIds.size >= 2 || hasOrphanedCarerShift;
  const carerFirstName = (shift: Shift): string | undefined => {
    if (!shift.carer_id && shift.status !== 'completed') return undefined;
    // `resolveMemberDisplayName` already falls back to `memberLabels.someone`
    // for a null/unresolvable id — a departed carer's completed shift
    // renders THAT rather than going blank, which would read as the
    // remaining carer's row (or as if nobody worked it at all).
    const fullName = resolveMemberDisplayName(
      shift.carer_id,
      currentUserId,
      membersByUserId,
      memberLabels
    );
    return fullName.split(' ')[0] ?? fullName;
  };
  const childrenQuery = useChildren(householdId);
  const carersQuery = useHouseholdCarers(householdId);
  const childrenById = useMemo(
    () => new Map((childrenQuery.data ?? []).map(child => [child.id, child])),
    [childrenQuery.data]
  );
  const items = useMemo(() => {
    const byDate = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const list = byDate.get(shift.local_date) ?? [];
      list.push(shift);
      byDate.set(shift.local_date, list);
    }

    const result: AgendaItem[] = [];
    const pushDays = (dates: Iterable<string>) => {
      // Days are visited chronologically and each day's rows are sorted by
      // `at`, so the first uncovered row this flips past IS the earliest
      // uncovered window in the visible week — see `isPrimary` above. One
      // call per week, so each week page keeps its own primary row.
      let primaryUncoveredAssigned = false;
      for (const localDate of [...dates].sort()) {
        const dayShifts = (byDate.get(localDate) ?? []).sort((a, b) =>
          a.starts_at.localeCompare(b.starts_at)
        );
        const totalMinutes =
          dayShifts.length === 0 ? null : totalCoveringMinutes(dayShifts);
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
            }
          | { kind: 'awaiting'; at: number; window: UncoveredWindowDisplay };

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
        for (const window of awaitingByDay?.[localDate] ?? []) {
          const askedByShift = overlappingShifts(window, dayShifts).some(
            shift => shift.status === 'pending'
          );
          if (!askedByShift) {
            timed.push({
              kind: 'awaiting',
              at: Date.parse(window.startsAt),
              window,
            });
          }
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
          } else if (row.kind === 'awaiting') {
            result.push({
              type: 'awaiting',
              key: `awaiting-${uncoveredKey(row.window)}`,
              localDate,
              window: row.window,
            });
          } else {
            const isPrimary = !primaryUncoveredAssigned;
            primaryUncoveredAssigned = true;
            result.push({
              type: 'uncovered',
              key: `uncovered-${uncoveredKey(row.window)}`,
              localDate,
              window: row.window,
              highlighted: row.highlighted,
              isPrimary,
            });
          }
        }
        placeNowLine();
      }
    };

    if (!weeks) {
      pushDays(
        new Set<string>([
          ...byDate.keys(),
          ...weekDates,
          ...(uncoveredByDay ? Object.keys(uncoveredByDay) : []),
          ...(awaitingByDay ? Object.keys(awaitingByDay) : []),
        ])
      );
      return result;
    }

    // A day no page owns (a shift whose own `local_date` falls just outside
    // the range it was fetched by) joins the week it falls in, or the first
    // week — dropping it would hide a real shift.
    const weekDays = weeks.map(week => new Set(week.dates));
    for (const date of new Set([
      ...byDate.keys(),
      ...(uncoveredByDay ? Object.keys(uncoveredByDay) : []),
      ...(awaitingByDay ? Object.keys(awaitingByDay) : []),
    ])) {
      if (weekDays.some(days => days.has(date))) continue;
      const owner = weeks.findLastIndex(week => week.weekStart <= date);
      weekDays[Math.max(0, owner)]?.add(date);
    }

    weeks.forEach((week, index) => {
      const key = `week-${week.weekStart}`;
      const label = formatWeekRangeLabel(week.dates);
      const days = [...(weekDays[index] ?? [])];
      const hasAnything = days.some(
        date =>
          byDate.has(date) ||
          (uncoveredByDay?.[date]?.length ?? 0) > 0 ||
          (awaitingByDay?.[date]?.length ?? 0) > 0 ||
          timeOffRowsForLocalDate(timeOff, date, householdTimeZone).length > 0
      );
      if (week.status !== 'ready' || !hasAnything) {
        result.push({
          type: 'weekStatus',
          key,
          weekStart: week.weekStart,
          label,
          status: week.status === 'ready' ? 'empty' : week.status,
          onRetry: week.onRetry,
        });
        return;
      }
      // Orientation in a continuous list: the week's range, in the list,
      // beside the rows it describes — never a pinned label that goes stale
      // as the reader scrolls. An empty / loading / failed week's single line
      // already names its range, so it gets no second one.
      result.push({
        type: 'weekLabel',
        key: `label-${week.weekStart}`,
        weekStart: week.weekStart,
        label,
      });
      pushDays(days);
      result.push({ type: 'weekEnd', key });
    });

    // The NOW block (the screen's hero: title, total, usual-week banner)
    // rides directly above the first day from today on — where the list
    // opens — so the old page top is what the reader sees first. Fallback:
    // after the current week when nothing loaded is upcoming.
    if (listHeader) {
      const firstUpcoming = result.findIndex(
        item => item.type === 'header' && item.localDate >= todayLocalDate
      );
      const afterAnchor =
        result.findIndex(item => item.key === `week-${heroWeekStart}`) + 1;
      result.splice(firstUpcoming >= 0 ? firstUpcoming : afterAnchor, 0, {
        type: 'hero',
        key: 'hero',
      });
    }
    return result;
  }, [
    shifts,
    timeOff,
    householdTimeZone,
    weekDates,
    weeks,
    heroWeekStart,
    listHeader,
    uncoveredByDay,
    awaitingByDay,
    focusUncoveredKey,
    todayLocalDate,
    nowMs,
    t,
  ]);

  // Once per key: pages loading later change `items` too, and re-running the
  // jump on each would yank the reader back to the gap mid-scroll.
  const scrolledToKey = useRef<string | null>(null);
  useEffect(() => {
    if (!focusUncoveredKey) {
      scrolledToKey.current = null;
      return;
    }
    if (!listRef?.current || scrolledToKey.current === focusUncoveredKey) {
      return;
    }
    const index = items.findIndex(
      item =>
        item.type === 'uncovered' &&
        uncoveredKey(item.window) === focusUncoveredKey
    );
    if (index >= 0) {
      scrolledToKey.current = focusUncoveredKey;
      listRef.current.scrollToIndex({ index, animated: false });
    }
  }, [focusUncoveredKey, items, listRef]);

  const heroIndex = items.findIndex(item => item.type === 'hero');
  const lastNowRequest = useRef(nowRequest);
  useEffect(() => {
    if (lastNowRequest.current === nowRequest) return;
    lastNowRequest.current = nowRequest;
    if (heroIndex >= 0) {
      listRef?.current?.scrollToIndex({ index: heroIndex, animated: true });
    }
  }, [nowRequest, heroIndex, listRef]);
  // FlashList 2.3.2 can fire onStartReached during mount, before the
  // initial offset (the NOW block) settles — which would fetch, and prepend,
  // last week on every open. Earlier weeks wait for a real drag.
  const [hasDragged, setHasDragged] = useState(false);

  // ux-schedule spec §4, "say it once": the generic part of every gap card
  // (why it's here, who hears what, where care hours live) rides once, above
  // the first card that needs action. Part of that item, so a jump to it
  // lands on the explainer too.
  // From today on, not the earliest loaded: the list opens on today and
  // past pages load above it, so an explainer pinned to a past gap would sit
  // scrolled away above everything the reader sees. Falls back to the first
  // gap when every gap loaded is in the past.
  const uncoveredItems = showUncoveredActions
    ? items.filter(item => item.type === 'uncovered')
    : [];
  const explainerKey =
    (
      uncoveredItems.find(
        item => item.type === 'uncovered' && item.localDate >= todayLocalDate
      ) ?? uncoveredItems[0]
    )?.key ?? null;

  const lastWeek = weeks?.[weeks.length - 1];
  const loadLaterFooter =
    onLoadLater && lastWeek?.status === 'ready' ? (
      // Scrolling to the end also loads the next week (onEndReached); this
      // is the same act for a reader who can't, or for when a short page
      // leaves the list still inside the end threshold.
      <Button
        testID="schedule-agenda-load-later"
        variant="ghost"
        size="sm"
        className="mx-5.5 self-start"
        onPress={onLoadLater}
      >
        {t('shifts.showNextWeek')}
      </Button>
    ) : null;

  return (
    <View testID="calendar-agenda-view" style={{ flex: 1 }}>
      <FlashList
        ref={listRef}
        testID="schedule-shifts-list"
        refreshing={refreshing}
        onRefresh={onRefresh}
        data={items}
        keyExtractor={item => item.key}
        getItemType={item => item.type}
        initialScrollIndex={heroIndex >= 0 ? heroIndex : undefined}
        ListHeaderComponent={weeks ? undefined : listHeader}
        ListFooterComponent={loadLaterFooter}
        onStartReached={hasDragged ? onLoadEarlier : undefined}
        onScrollBeginDrag={() => setHasDragged(true)}
        onEndReached={onLoadLater}
        contentContainerStyle={{ paddingBottom: tabBarScrollPadding }}
        renderItem={({ item }) => {
          if (item.type === 'hero') {
            return <View testID="schedule-agenda-now">{listHeader}</View>;
          }
          if (item.type === 'weekLabel') {
            return (
              <MetadataLabel
                testID={`schedule-agenda-week-label-${item.weekStart}`}
                className="px-5.5 pt-4 pb-1 text-muted-strong"
                tabular
              >
                {item.label}
              </MetadataLabel>
            );
          }
          if (item.type === 'weekEnd') {
            return <View />;
          }
          if (item.type === 'weekStatus') {
            const testID = `schedule-agenda-week-${item.status}-${item.weekStart}`;
            if (item.status === 'loading') {
              return (
                <View
                  testID={testID}
                  accessibilityLabel={t('shifts.weekLoading', {
                    range: item.label,
                  })}
                  className="items-center py-4"
                >
                  <LoadingDots />
                </View>
              );
            }
            if (item.status === 'error') {
              return (
                <View className="mx-5.5 mb-2">
                  <InlineRetry
                    testID={testID}
                    message={t('shifts.weekLoadFailed', { range: item.label })}
                    onRetry={() => item.onRetry?.()}
                  />
                </View>
              );
            }
            return (
              <View testID={testID} className="mx-5.5 mb-2 py-2">
                <Small className="text-muted-foreground">
                  {t('shifts.weekEmpty', { range: item.label })}
                </Small>
              </View>
            );
          }
          if (item.type === 'header') {
            return (
              <DayHeader
                testID={`schedule-day-${item.localDate}`}
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
            return (
              <NowLine
                label={formatShiftTime(
                  new Date(nowMs).toISOString(),
                  displayTimeZone
                )}
                testID="schedule-now-line"
              />
            );
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
          if (item.type === 'uncovered' || item.type === 'awaiting') {
            if (!householdId) {
              return null;
            }
            const child = childrenById.get(item.window.childId);
            const isUncovered = item.type === 'uncovered';
            const row = (
              <UncoveredRow
                awaiting={!isUncovered}
                localDate={item.localDate}
                window={item.window}
                highlighted={isUncovered && item.highlighted}
                isPrimary={isUncovered && item.isPrimary}
                nowMs={nowMs}
                householdId={householdId}
                displayTimeZone={displayTimeZone}
                childName={child?.name ?? ''}
                showActions={showUncoveredActions}
                carers={carersQuery.data ?? []}
                shifts={shifts}
                currentUserId={currentUserId}
                membersByUserId={membersByUserId}
                memberLabels={memberLabels}
                closedReason={closedReason}
                commitments={commitments}
                pendingPattern={pendingPattern}
              />
            );
            if (item.key !== explainerKey) {
              return row;
            }
            return (
              <View>
                <View
                  testID="schedule-uncovered-explainer"
                  className="mx-5.5 mb-2 gap-2"
                >
                  <Small className="text-muted-foreground">
                    {t('cover.explainer')}
                  </Small>
                  {/* A ghost Button, not a bare Pressable wrapping coloured
                      Body text — see SchedulePatternBanner.tsx:222-234. */}
                  <Button
                    testID="schedule-uncovered-hours-explainer"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onPress={() => router.push('/settings/children' as Href)}
                  >
                    {t('cover.hoursWrong')}
                  </Button>
                </View>
                {row}
              </View>
            );
          }
          if (item.type !== 'shift') {
            return null;
          }
          const assignedChildren = (item.shift.shift_children ?? []).flatMap(
            link => {
              const child = childrenById.get(link.child_id);
              return child
                ? [
                    {
                      id: child.id,
                      name: child.name,
                      colour: child.colour,
                    },
                  ]
                : [];
            }
          );
          // D77a: a shift keeps rendering as a normally-booked row even when
          // its own carer has accepted time off across it — nothing on the
          // row itself said the two collide. `ShiftRow` is shared with the
          // parent-cover flow and out of scope here, so the flag is a
          // sibling pill beneath the row rather than a prop threaded into
          // it — same StatusPill vocabulary (`uncovered`, the "unattended"
          // hue) the coverage gap rows already use.
          const hasTimeOffConflict = shiftOverlapsTimeOff(item.shift, timeOff);
          return (
            <View>
              <ShiftRow
                shift={item.shift}
                displayTimeZone={displayTimeZone}
                carerName={showCarerNames ? carerFirstName(item.shift) : null}
                carerColour={
                  showCarerNames && item.shift.carer_id
                    ? (membersByUserId.get(item.shift.carer_id)?.colour ??
                      undefined)
                    : undefined
                }
                assignedChildren={assignedChildren}
                currentUserId={currentUserId}
                membersByUserId={membersByUserId}
                memberLabels={memberLabels}
                showParentCoverUndo={
                  showUncoveredActions &&
                  item.shift.kind === SHIFT_KINDS.PARENT_COVER
                }
                coverUndoDisabledReason={closedReason}
                runningShiftIds={runningShiftIds}
                pendingAskActions={
                  showUncoveredActions && isOutstandingCoverAsk(item.shift) ? (
                    <PendingAskActions
                      shift={item.shift}
                      carerName={carerFirstName(item.shift) ?? ''}
                      closedReason={closedReason}
                    />
                  ) : undefined
                }
              />
              {hasTimeOffConflict ? (
                <View
                  testID={`schedule-shift-timeoff-conflict-${item.shift.id}`}
                  className="mx-5.5 mb-2 flex-row items-center"
                  style={{ marginTop: -8 }}
                >
                  <StatusPill
                    variant="uncovered"
                    label={t('shifts.timeOffConflict')}
                  />
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}
