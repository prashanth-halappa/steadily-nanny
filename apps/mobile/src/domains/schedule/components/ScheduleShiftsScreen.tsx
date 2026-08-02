/**
 * @module domains/schedule/components/ScheduleShiftsScreen
 *
 * Both parent- and nanny-facing: the current week's materialised shifts,
 * grouped by day. Route: `/schedule/shifts`.
 *
 * `GET /v1/households/:householdId/shifts` (`useShiftsRange`) is being
 * built concurrently by another agent — until it ships, calls 404. This
 * screen MUST tolerate that gracefully: an honest "not available yet" empty
 * state, never a crash, never fabricated data, never a generic error
 * screen. `isShiftsRouteUnavailable(error)` is the sanctioned way to detect
 * that specific case; any other query error degrades to the same
 * "unavailable" treatment rather than exposing a raw error, since this
 * screen set has no separate generic-error UI.
 *
 * WEEKDAY CONVENTION: day-group headers derive the Postgres `extract(dow)`
 * index (0=Sunday..6=Saturday) from `local_date`'s own YYYY-MM-DD
 * components (never `new Date(isoString)`, which parses as UTC midnight and
 * can land on the wrong local day) and key off the shared `weekday.0..6`
 * i18n block.
 */

import { FlashList } from '@shopify/flash-list';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import {
  StatusPill,
  type StatusPillProps,
} from '@/src/components/ui/status-pill';
import { Body, H1, H2 } from '@/src/components/ui/typography';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  isShiftsRouteUnavailable,
  useShiftsRange,
} from '@/src/hooks/queries/useShiftsRange';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { formatInstantInZone } from '@/src/lib/displayTime';

type ShiftStatusVariant = NonNullable<StatusPillProps['variant']>;

const STATUS_TO_VARIANT: Record<Shift['status'], ShiftStatusVariant> = {
  draft: 'pending',
  pending: 'pending',
  confirmed: 'confirmed',
  declined: 'declined',
  cancelled: 'cancelled',
  completed: 'confirmed',
};

type ListItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'shift'; key: string; shift: Shift };

/** Parses a "YYYY-MM-DD" string into local calendar-date components — never
 * `new Date(isoString)`, which parses as UTC midnight and can land on the
 * wrong local day depending on the device's timezone. */
function localDateToWeekday(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getDay();
}

/** Groups shifts by `local_date` (ascending) into a flat header+row list for
 * `FlashList`, sorting shifts within a day by start time. */
function groupShiftsByDay(
  shifts: Shift[],
  weekdayLabel: (dow: number) => string
): ListItem[] {
  const sorted = [...shifts].sort((a, b) =>
    a.local_date === b.local_date
      ? a.starts_at.localeCompare(b.starts_at)
      : a.local_date.localeCompare(b.local_date)
  );

  const items: ListItem[] = [];
  let currentDate: string | null = null;
  for (const shift of sorted) {
    if (shift.local_date !== currentDate) {
      currentDate = shift.local_date;
      items.push({
        type: 'header',
        key: `header-${shift.local_date}`,
        label: `${weekdayLabel(localDateToWeekday(shift.local_date))} · ${shift.local_date}`,
      });
    }
    items.push({ type: 'shift', key: shift.id, shift });
  }
  return items;
}

/**
 * This week's [Monday 00:00, next Monday 00:00) range as full ISO datetime
 * strings with an offset — `GET /households/:householdId/shifts` validates
 * `from`/`to` with `z.iso.datetime({ offset: true })`
 * (`apps/api/src/domains/shift/schemas.ts`'s `ShiftRangeQuerySchema`), a
 * plain "YYYY-MM-DD" calendar date is REJECTED with a 400. Local calendar
 * boundaries are computed first (Monday-first, en-GB) and only converted to
 * UTC instants at the very end via `toISOString()`.
 */
function currentWeekRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const dow = now.getDay(); // 0=Sunday..6=Saturday
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + diffToMonday
  );
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return { from: monday.toISOString(), to: nextMonday.toISOString() };
}

function formatShiftTime(isoInstant: string, timeZone?: string | null): string {
  if (timeZone) {
    return formatInstantInZone(isoInstant, timeZone);
  }
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduleShiftsScreen() {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const profile = useUserProfile();
  const { from, to } = currentWeekRange();
  const shiftsQuery = useShiftsRange(onboarding.householdId, from, to);

  const isLoading = onboarding.status === 'loading' || shiftsQuery.isLoading;
  const routeUnavailable =
    shiftsQuery.isError && isShiftsRouteUnavailable(shiftsQuery.error);
  // Any other query error also degrades to the "unavailable" treatment —
  // there is no separate generic-error UI in this screen set, and an honest
  // "not available yet" message beats a crash or a raw error.
  const showUnavailable = routeUnavailable || shiftsQuery.isError;

  const shifts = shiftsQuery.data ?? [];
  const showEmpty = !isLoading && !showUnavailable && shifts.length === 0;
  const showList = !isLoading && !showUnavailable && shifts.length > 0;

  const items = showList
    ? groupShiftsByDay(shifts, dow => t(`weekday.${dow}`))
    : [];

  return (
    <View
      testID="schedule-shifts-screen"
      style={{ flex: 1 }}
      className="bg-background"
    >
      <SafeAreaView style={{ flex: 1 }} className="bg-background">
        <View className="px-6 pt-4 pb-2">
          <Pressable
            testID="schedule-shifts-back"
            accessibilityRole="button"
            accessibilityLabel={tCommon('back')}
            onPress={() => router.back()}
            hitSlop={8}
            className="mb-2 self-start"
          >
            <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
          </Pressable>
          <H1>{t('shifts.screenTitle')}</H1>
        </View>

        {isLoading ? (
          <View style={{ flex: 1 }} className="items-center justify-center">
            <LoadingIndicator />
          </View>
        ) : null}

        {showUnavailable ? (
          <View testID="schedule-shifts-unavailable" style={{ flex: 1 }}>
            <EmptyState
              variant="default"
              title={t('shifts.screenTitle')}
              description={t('shifts.unavailable')}
            />
          </View>
        ) : null}

        {showEmpty ? (
          <View testID="schedule-shifts-empty" style={{ flex: 1 }}>
            <EmptyState
              variant="default"
              title={t('shifts.empty')}
              description=""
            />
          </View>
        ) : null}

        {showList ? (
          <View style={{ flex: 1 }}>
            <FlashList
              testID="schedule-shifts-list"
              data={items}
              keyExtractor={item => item.key}
              getItemType={item => item.type}
              renderItem={({ item }) =>
                item.type === 'header' ? (
                  <View className="px-6 pt-4 pb-1">
                    <H2>{item.label}</H2>
                  </View>
                ) : (
                  <ShiftRow
                    shift={item.shift}
                    displayTimeZone={profile.data?.timezone}
                  />
                )
              }
            />
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const STATUS_TO_LABEL_KEY: Record<Shift['status'], string> = {
  draft: 'shifts.statusDraft',
  pending: 'shifts.statusPending',
  confirmed: 'shifts.statusConfirmed',
  declined: 'shifts.statusDeclined',
  cancelled: 'shifts.statusCancelled',
  completed: 'shifts.statusCompleted',
};

function ShiftRow({
  shift,
  displayTimeZone,
}: {
  shift: Shift;
  displayTimeZone?: string | null;
}) {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const variant = STATUS_TO_VARIANT[shift.status];

  return (
    <Pressable
      testID={`schedule-shift-${shift.id}`}
      accessibilityRole="button"
      onPress={() =>
        router.push(`/(private)/schedule/shifts/${shift.id}` as Href)
      }
      className="mx-6 mb-2 flex-row items-center justify-between rounded-lg bg-muted p-3"
    >
      <View className="gap-1">
        <Body>
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
