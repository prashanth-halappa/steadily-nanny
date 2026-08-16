/**
 * @module domains/schedule/components/ShiftRow
 *
 * One agenda shift row. Extracted from AgendaView so the row's three visual
 * modes (parent-cover, resolved, live) can be tested without FlashList.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import {
  SHIFT_KINDS,
  type Shift,
} from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import { LiveDot } from '@/src/components/ui/live-dot';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Body, Figure, Small } from '@/src/components/ui/typography';
import { resolveMemberDisplayName } from '@/src/domains/schedule/utils/memberDisplayName';
import {
  formatShiftTime,
  RESOLVED_STATUSES,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { useRemoveParentCover } from '@/src/hooks/mutations/useRemoveParentCover';
import { useElevation } from '~/lib/design-tokens/elevation';

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

export function ShiftRow({
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
  membersByUserId: Map<string, HouseholdMember>;
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
