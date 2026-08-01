/**
 * @module domains/setup/components/AvailabilityScreen
 *
 * Nanny setup step 2 (final): pick which weekdays you're available, and a
 * time window per selected day. Persisted server-side via
 * `PUT /v1/availability/me` (one weekday row per call — see
 * `src/api/endpoints/availability.ts`). Each toggle/time-range edit sends the
 * FULL row for that weekday immediately; there is no separate local draft.
 *
 * WEEKDAY CONVENTION: the DB (and `WeekStrip`) use Postgres `extract(dow)` —
 * 0=Sunday..6=Saturday — NOT display position. `WeekStrip.onToggle` already
 * reports in that convention, so the values below are sent to the API
 * unchanged; the Monday-first rendering is presentation-only.
 */
import { CARER_EVENING_MODES } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { type Href, useRouter } from 'expo-router';
import { View } from 'react-native';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { Body } from '@/src/components/ui/typography';
import { WeekStrip } from '@/src/components/ui/week-strip';
import { SetupScreenShell } from '@/src/domains/setup/components/SetupScreenShell';
import { useUpsertAvailability } from '@/src/hooks/mutations/useUpsertAvailability';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useSetupProgressStore } from '@/src/store/setupProgress';

const DAY_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

/** Monday-first render order (en-GB), matching WeekStrip's own display order. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_START = '09:00';
const DEFAULT_FINISH = '17:00';

export function AvailabilityScreen() {
  const router = useRouter();
  const complete = useSetupProgressStore(s => s.complete);

  const availability = useAvailability();
  const upsertAvailability = useUpsertAvailability();

  const rows = availability.data ?? [];
  const rowByWeekday = new Map(rows.map(row => [row.weekday, row]));

  const selectedDays = rows
    .filter(row => row.is_available)
    .map(row => row.weekday);

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

  const onFinish = () => {
    complete();
    router.replace('/(private)/(tabs)/home' as Href);
  };

  return (
    <SetupScreenShell
      testID="availability-screen"
      progress={1}
      title="When are you available?"
      subtitle="Select the days you can work, then set your usual hours for each."
      ctaLabel="Finish"
      ctaDisabled={selectedDays.length === 0}
      onCta={onFinish}
    >
      {availability.isLoading ? (
        <LoadingIndicator />
      ) : (
        <>
          <WeekStrip
            testID="availability-week-strip"
            selected={selectedDays}
            onToggle={onToggleDay}
          />

          <View className="gap-4">
            {DISPLAY_ORDER.filter(
              day => rowByWeekday.get(day)?.is_available
            ).map(day => (
              <View key={day} className="gap-2">
                <Body className="font-sora-medium">{DAY_LABELS[day]}</Body>
                <TimeRangePicker
                  testID={`availability-time-range-${day}`}
                  start={rowByWeekday.get(day)?.earliest_start ?? DEFAULT_START}
                  end={rowByWeekday.get(day)?.latest_finish ?? DEFAULT_FINISH}
                  onChange={(start, end) => upsertDay(day, { start, end })}
                />
              </View>
            ))}
          </View>
        </>
      )}
    </SetupScreenShell>
  );
}
