/**
 * @module domains/schedule/components/AgendaView
 *
 * Calendar view 2a — day-by-day shift list (reuses ScheduleShiftsScreen logic).
 */
import { FlashList } from '@shopify/flash-list';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Body, DayGroup } from '@/src/components/ui/typography';
import {
  formatShiftTime,
  groupShiftsByDay,
} from '@/src/domains/schedule/utils/shiftGrouping';
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
}

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

export function AgendaView({ shifts, displayTimeZone }: AgendaViewProps) {
  const { t } = useTranslation('schedule');
  const items = groupShiftsByDay(shifts, dow => t(`weekday.${dow}`));

  return (
    <View testID="calendar-agenda-view" style={{ flex: 1 }}>
      <FlashList
        testID="schedule-shifts-list"
        data={items}
        keyExtractor={item => item.key}
        getItemType={item => item.type}
        renderItem={({ item }) =>
          item.type === 'header' ? (
            <View className="px-6 pt-4 pb-1">
              <DayGroup>{item.label}</DayGroup>
            </View>
          ) : (
            <ShiftRow shift={item.shift} displayTimeZone={displayTimeZone} />
          )
        }
      />
    </View>
  );
}
