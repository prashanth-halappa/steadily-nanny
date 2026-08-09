/**
 * @module domains/setup/components/AvailabilityEditor
 *
 * The weekday/time-range editor body, extracted out of `AvailabilityScreen`
 * so it can be reused, unchanged, by the post-onboarding settings entry
 * point (`ManageAvailabilityScreen`). Persisted server-side via
 * `PUT /v1/availability/me` (one weekday row per call — see
 * `src/api/endpoints/availability.ts`). Each toggle sends the FULL row for
 * that weekday immediately; time-range edits use per-weekday draft state
 * seeded from the query and upsert only when the draft range is valid.
 * Invalid drafts show the picker's derived inline error.
 *
 * WEEKDAY CONVENTION: the DB (and `WeekStrip`) use Postgres `extract(dow)` —
 * 0=Sunday..6=Saturday — NOT display position. `WeekStrip.onToggle` already
 * reports in that convention, so the values below are sent to the API
 * unchanged; the Monday-first rendering is presentation-only. Day labels
 * come from the shared `schedule:weekday.*` i18n block (the same one
 * `ScheduleShiftsScreen`/`ScheduleBuildScreen` use) rather than a local
 * copy, so there is exactly one translated weekday-name table in the app.
 */
import { CARER_EVENING_MODES } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';
import { Body } from '@/src/components/ui/typography';
import { WeekStrip } from '@/src/components/ui/week-strip';
import { useUpsertAvailability } from '@/src/hooks/mutations/useUpsertAvailability';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const DEFAULT_START = '09:00';
const DEFAULT_FINISH = '17:00';

interface DayDraft {
  start: string;
  end: string;
}

export function AvailabilityEditor() {
  const { t } = useTranslation('schedule');

  const availability = useAvailability();
  const upsertAvailability = useUpsertAvailability();
  const profile = useUserProfile();
  const displayOrder = getWeekdayOrder(profile.data?.week_starts_on);

  const rows = availability.data ?? [];
  const rowByWeekday = new Map(rows.map(row => [row.weekday, row]));

  const [draft, setDraft] = useState<Record<number, DayDraft>>({});

  useEffect(() => {
    if (!availability.data) return;
    const next: Record<number, DayDraft> = {};
    for (const row of availability.data) {
      if (row.is_available) {
        next[row.weekday] = {
          start: row.earliest_start ?? DEFAULT_START,
          end: row.latest_finish ?? DEFAULT_FINISH,
        };
      }
    }
    setDraft(next);
  }, [availability.data]);

  // Send the FULL row every time — PUT /me is a full-replace upsert for that
  // weekday, so a partial body would drop whatever wasn't included.
  const upsertDay = (
    day: number,
    overrides: { isAvailable?: boolean; start?: string; end?: string }
  ) => {
    const existing = rowByWeekday.get(day);
    upsertAvailability.mutate({
      weekday: day,
      is_available: overrides.isAvailable ?? existing?.is_available ?? false,
      earliest_start:
        overrides.start ?? existing?.earliest_start ?? DEFAULT_START,
      latest_finish: overrides.end ?? existing?.latest_finish ?? DEFAULT_FINISH,
      evening_mode: existing?.evening_mode ?? CARER_EVENING_MODES.SOMETIMES,
    });
  };

  const onToggleDay = (day: number) => {
    const existing = rowByWeekday.get(day);
    upsertDay(day, { isAvailable: !(existing?.is_available ?? false) });
  };

  const onTimeChange = (day: number, start: string, end: string) => {
    setDraft(prev => ({ ...prev, [day]: { start, end } }));
    if (isEndAfterStart(start, end)) {
      upsertDay(day, { start, end });
    }
  };

  const selectedDays = rows
    .filter(row => row.is_available)
    .map(row => row.weekday);

  if (availability.isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <>
      <WeekStrip
        testID="availability-week-strip"
        selected={selectedDays}
        onToggle={onToggleDay}
        weekStartsOn={profile.data?.week_starts_on}
      />

      <View className="gap-4">
        {displayOrder
          .filter(day => rowByWeekday.get(day)?.is_available)
          .map(day => {
            const times = draft[day] ?? {
              start: rowByWeekday.get(day)?.earliest_start ?? DEFAULT_START,
              end: rowByWeekday.get(day)?.latest_finish ?? DEFAULT_FINISH,
            };
            return (
              <View key={day} className="gap-2">
                <Body weight="medium">{t(`weekday.${day}`)}</Body>
                <TimeRangePicker
                  testID={`availability-time-range-${day}`}
                  start={times.start}
                  end={times.end}
                  onChange={(start, end) => onTimeChange(day, start, end)}
                />
              </View>
            );
          })}
      </View>
    </>
  );
}
