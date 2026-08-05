/**
 * @module domains/schedule/components/AgendaView
 *
 * Calendar view 2a — day-by-day shift list, with Away bands for carer time off.
 */
import { FlashList } from '@shopify/flash-list';
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useTabBarScrollPadding } from '@/lib/layout/useTabBarScrollPadding';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Body, DayGroup, Small } from '@/src/components/ui/typography';
import {
  formatShiftTime,
  localDateToWeekday,
} from '@/src/domains/schedule/utils/shiftGrouping';
import { timeOffRowsForLocalDate } from '@/src/domains/schedule/utils/timeOffOverlap';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
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

interface AgendaViewProps {
  shifts: Shift[];
  displayTimeZone?: string | null;
  timeOff?: CarerTimeOff[];
  householdTimeZone?: string;
  /** Local calendar dates in the visible week — used for Away-only days. */
  weekDates?: string[];
}

type AgendaItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'away'; key: string; localDate: string; message: string | null }
  | { type: 'shift'; key: string; shift: Shift };

function ShiftRow({
  shift,
  displayTimeZone,
}: {
  shift: Shift;
  displayTimeZone?: string | null;
}) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const elevation = useElevation();
  const variant = STATUS_TO_VARIANT[shift.status];

  return (
    <Pressable
      testID={`schedule-shift-${shift.id}`}
      accessibilityRole="button"
      onPress={() =>
        router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
      }
      className="mx-6 mb-2 flex-row items-center justify-between rounded-row bg-card p-3"
      style={elevation.row}
    >
      <View className="gap-1">
        <Body tabular>
          {formatShiftTime(shift.starts_at, displayTimeZone)} –{' '}
          {formatShiftTime(shift.ends_at, displayTimeZone)}
        </Body>
      </View>
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
    </Pressable>
  );
}

export function AgendaView({
  shifts,
  displayTimeZone,
  timeOff = [],
  householdTimeZone = 'UTC',
  weekDates = [],
}: AgendaViewProps) {
  const { t } = useTranslation('schedule');
  // Same tab-bar dead-zone fix as Settings (BUG1) — this is one of the
  // Schedule tab's own scrollable views, so it needs the same real
  // clearance a fixed magic number can't give.
  const tabBarScrollPadding = useTabBarScrollPadding();
  const items = useMemo(() => {
    const byDate = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const list = byDate.get(shift.local_date) ?? [];
      list.push(shift);
      byDate.set(shift.local_date, list);
    }

    const dates = new Set<string>([
      ...byDate.keys(),
      ...weekDates.filter(
        d => timeOffRowsForLocalDate(timeOff, d, householdTimeZone).length > 0
      ),
    ]);

    const result: AgendaItem[] = [];
    for (const localDate of [...dates].sort()) {
      result.push({
        type: 'header',
        key: `header-${localDate}`,
        label: `${t(`weekday.${localDateToWeekday(localDate)}`)} · ${formatDisplayDate(localDate)}`,
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
      const dayShifts = (byDate.get(localDate) ?? []).sort((a, b) =>
        a.starts_at.localeCompare(b.starts_at)
      );
      for (const shift of dayShifts) {
        result.push({ type: 'shift', key: shift.id, shift });
      }
    }
    return result;
  }, [shifts, timeOff, householdTimeZone, weekDates, t]);

  return (
    <View testID="calendar-agenda-view" style={{ flex: 1 }}>
      <FlashList
        testID="schedule-shifts-list"
        data={items}
        keyExtractor={item => item.key}
        getItemType={item => item.type}
        contentContainerStyle={{ paddingBottom: tabBarScrollPadding }}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return (
              <View className="px-6 pt-4 pb-1">
                <DayGroup>{item.label}</DayGroup>
              </View>
            );
          }
          if (item.type === 'away') {
            return (
              <View
                testID={`schedule-away-${item.localDate}`}
                className="mx-6 mb-2 rounded-row bg-muted px-3 py-2"
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
          return (
            <ShiftRow shift={item.shift} displayTimeZone={displayTimeZone} />
          );
        }}
      />
    </View>
  );
}
