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
 * SEVEN ALWAYS-VISIBLE ROWS, not a `WeekStrip`. The strip renders unselected
 * chips with no fill and no border, so a screen that opens with zero days
 * selected has nothing on it that looks tappable — a real nanny read the
 * M T W T F S S letters as a header. One switch row per day (the same shape
 * as `NotificationPrefsScreen`'s type list) states the affordance outright.
 * `WeekStrip` is untouched: it still renders on the schedule-build and
 * parent usual-week screens, where days arrive pre-selected.
 *
 * WEEKDAY CONVENTION: the DB uses Postgres `extract(dow)` — 0=Sunday..
 * 6=Saturday — NOT display position. `getWeekdayOrder` only rotates the
 * rendering order; the values below are sent to the API unchanged. Day
 * labels come from the shared `schedule:weekday.*` i18n block (the same one
 * `ScheduleShiftsScreen`/`ScheduleBuildScreen` use) rather than a local
 * copy, so there is exactly one translated weekday-name table in the app.
 */
import { CARER_EVENING_MODES } from '@steadily-nanny/shared-types/schemas/availability.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
// `Button` already fires the `light` impact on press (see its `haptic` prop),
// so apply-to-all needs no haptic call of its own — acknowledged tier, and
// deliberately no toast.
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Switch } from '@/src/components/ui/switch';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';
import { Body, Small } from '@/src/components/ui/typography';
import { useUpsertAvailability } from '@/src/hooks/mutations/useUpsertAvailability';
import { useAvailability } from '@/src/hooks/queries/useAvailability';
import { useUserProfile } from '@/src/hooks/queries/useUserProfile';
import { formatNominalWallClockDisplay } from '@/src/lib/wallClock';
import { getWeekdayOrder } from '@/src/lib/weekdayOrder';

const DEFAULT_START = '09:00';
const DEFAULT_FINISH = '17:00';

interface DayDraft {
  start: string;
  end: string;
}

export function AvailabilityEditor() {
  const { t } = useTranslation('schedule');
  const { t: tHousehold } = useTranslation('household');

  const availability = useAvailability();
  const upsertAvailability = useUpsertAvailability();
  const profile = useUserProfile();
  const displayOrder = getWeekdayOrder(profile.data?.week_starts_on);

  const rows = availability.data ?? [];
  const rowByWeekday = new Map(rows.map(row => [row.weekday, row]));

  const [draft, setDraft] = useState<Record<number, DayDraft>>({});
  /** Non-null only right after an apply-to-all — the inline confirmation. */
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

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

  const timesFor = (day: number): DayDraft =>
    draft[day] ?? {
      start: rowByWeekday.get(day)?.earliest_start ?? DEFAULT_START,
      end: rowByWeekday.get(day)?.latest_finish ?? DEFAULT_FINISH,
    };

  const onToggleDay = (day: number) => {
    const existing = rowByWeekday.get(day);
    setAppliedCount(null);
    upsertDay(day, { isAvailable: !(existing?.is_available ?? false) });
  };

  const onTimeChange = (day: number, start: string, end: string) => {
    setDraft(prev => ({ ...prev, [day]: { start, end } }));
    setAppliedCount(null);
    if (isEndAfterStart(start, end)) {
      upsertDay(day, { start, end });
    }
  };

  const enabledDays = displayOrder.filter(
    day => rowByWeekday.get(day)?.is_available
  );

  // Copy one day's hours onto every OTHER enabled day. Disabled days are
  // never touched — turning a day on is a separate decision from its hours.
  const onApplyToOtherDays = (day: number) => {
    const { start, end } = timesFor(day);
    const others = enabledDays.filter(other => other !== day);
    setDraft(prev => {
      const next = { ...prev };
      for (const other of others) next[other] = { start, end };
      return next;
    });
    for (const other of others) {
      upsertDay(other, { start, end });
    }
    setAppliedCount(others.length);
  };

  if (availability.isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <Card className="gap-4 p-4">
      {displayOrder.map(day => {
        const isOn = rowByWeekday.get(day)?.is_available ?? false;
        const times = timesFor(day);
        // Under the FIRST enabled day only, and only when there is another
        // enabled day to copy onto — with one day on it would be a no-op.
        const showApply = enabledDays.length > 1 && enabledDays[0] === day;
        return (
          <View key={day} className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <Body weight="medium" className="flex-1">
                {t(`weekday.${day}`)}
              </Body>
              {isOn ? (
                <Small tabular className="text-muted-foreground">
                  {`${formatNominalWallClockDisplay(times.start)} – ${formatNominalWallClockDisplay(times.end)}`}
                </Small>
              ) : null}
              <Switch
                testID={`availability-day-switch-${day}`}
                checked={isOn}
                onCheckedChange={() => onToggleDay(day)}
              />
            </View>
            {isOn ? (
              <View className="gap-2">
                <TimeRangePicker
                  testID={`availability-time-range-${day}`}
                  start={times.start}
                  end={times.end}
                  onChange={(start, end) => onTimeChange(day, start, end)}
                />
                {showApply ? (
                  <>
                    <Button
                      testID="availability-apply-to-other-days"
                      variant="ghost"
                      size="sm"
                      onPress={() => onApplyToOtherDays(day)}
                    >
                      <Text>{tHousehold('availability.applyToOtherDays')}</Text>
                    </Button>
                    {appliedCount === null ? null : (
                      <Small
                        testID="availability-applied-confirmation"
                        className="text-muted-foreground"
                      >
                        {tHousehold('availability.appliedToOtherDays', {
                          count: appliedCount,
                        })}
                      </Small>
                    )}
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
