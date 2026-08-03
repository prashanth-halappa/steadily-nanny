/**
 * @module domains/settings/components/CalendarPickerSheet
 *
 * Lists writable device calendars grouped by account source. Surfaces the
 * honest empty state when only local calendars exist (EventKit can't see
 * the Google Calendar app alone).
 */
import { Check } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Body, H3, Small } from '@/src/components/ui/typography';
import {
  listWritableCalendars,
  type WritableCalendar,
} from '@/src/domains/schedule/utils/calendarSyncNative';
import {
  groupCalendarsBySource,
  hasNonLocalWritableCalendar,
} from '@/src/domains/settings/utils/calendarPickerGroups';

interface CalendarPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  selectedCalendarId: string | null;
  onSelect: (calendar: WritableCalendar) => void;
}

export function CalendarPickerSheet({
  visible,
  onDismiss,
  selectedCalendarId,
  onSelect,
}: CalendarPickerSheetProps) {
  const { t } = useTranslation('settings');
  const [calendars, setCalendars] = useState<WritableCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLocalAnyway, setShowLocalAnyway] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShowLocalAnyway(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listWritableCalendars()
      .then(list => {
        if (!cancelled) setCalendars(list);
      })
      .catch(() => {
        if (!cancelled) setCalendars([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const hasRemote = hasNonLocalWritableCalendar(calendars);
  const onlyLocal = !loading && calendars.length > 0 && !hasRemote;
  const showEmptyPrompt = onlyLocal && !showLocalAnyway;

  const visibleGroups = useMemo(() => {
    if (loading || showEmptyPrompt) return [];
    if (hasRemote && !showLocalAnyway) {
      return groupCalendarsBySource(calendars.filter(c => !c.isLocal));
    }
    if (onlyLocal && showLocalAnyway) {
      return groupCalendarsBySource(calendars.filter(c => c.isLocal));
    }
    return groupCalendarsBySource(calendars);
  }, [
    calendars,
    hasRemote,
    loading,
    onlyLocal,
    showEmptyPrompt,
    showLocalAnyway,
  ]);

  return (
    <BottomSheetBase
      sheetId="calendar-picker"
      visible={visible}
      onDismiss={onDismiss}
      fitContent
      testID="calendar-picker-sheet"
    >
      <View className="gap-3 px-6 pb-4">
        <H3>{t('settings:time.calendarSync.pickerTitle')}</H3>

        {loading ? (
          <View testID="calendar-picker-loading" className="items-center py-6">
            <LoadingIndicator />
          </View>
        ) : null}

        {showEmptyPrompt ? (
          <View testID="calendar-picker-empty" className="gap-3">
            <Body className="font-medium">
              {t('settings:time.calendarSync.emptyTitle')}
            </Body>
            <Small className="text-muted-foreground">
              {t('settings:time.calendarSync.emptyBody')}
            </Small>
            <AnimatedPressable
              testID="calendar-picker-use-local"
              onPress={() => setShowLocalAnyway(true)}
            >
              <Body className="text-primary">
                {t('settings:time.calendarSync.useLocalAnyway')}
              </Body>
            </AnimatedPressable>
            <AnimatedPressable
              testID="calendar-picker-cancel"
              onPress={onDismiss}
            >
              <Body>{t('settings:time.calendarSync.cancel')}</Body>
            </AnimatedPressable>
          </View>
        ) : null}

        {visibleGroups.map(group => (
          <View
            key={`${group.sourceName}-${group.isLocal ? 'local' : 'remote'}`}
            className="gap-1"
            testID={`calendar-source-${group.sourceName}`}
          >
            <Small className="text-muted-foreground">{group.sourceName}</Small>
            {group.calendars.map(cal => {
              const selected = cal.id === selectedCalendarId;
              return (
                <AnimatedPressable
                  key={cal.id}
                  testID={`calendar-option-${cal.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(cal)}
                >
                  <View className="flex-row items-center justify-between py-2">
                    <Body className={selected ? 'text-primary' : undefined}>
                      {cal.title}
                    </Body>
                    {selected ? <Check size={18} /> : null}
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>
        ))}
      </View>
    </BottomSheetBase>
  );
}
