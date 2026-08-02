/**
 * @module domains/schedule/components/ShiftDetailScreen
 *
 * D23/D24 — single-shift detail: parent can edit wall-clock times + note;
 * nanny is read-only. Hosts the shift-scoped day thread.
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1, H2, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useUpdateShift } from '@/src/hooks/mutations/useUpdateShift';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useShift } from '@/src/hooks/queries/useShift';
import { useShiftEvents } from '@/src/hooks/queries/useShiftEvents';
import { showSuccessToast } from '@/src/lib/toast';
import { utcIsoToWallClockHHMM, wallClockToUtcIso } from '@/src/lib/wallClock';

const KNOWN_EVENT_TYPES = new Set([
  'shift_updated',
  'pattern_conflict',
  'gap_raised',
]);

export function ShiftDetailScreen() {
  const { t } = useTranslation('schedule');
  const router = useRouter();
  const params = useLocalSearchParams<{ shiftId?: string }>();
  const shiftId = typeof params.shiftId === 'string' ? params.shiftId : null;
  const onboarding = useIsOnboarded();
  const shiftQuery = useShift(shiftId);
  const eventsQuery = useShiftEvents(onboarding.householdId, shiftId);
  const updateShift = useUpdateShift();

  const shift = shiftQuery.data;
  const isParent = onboarding.role === SETUP_ROLES.PARENT;
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [note, setNote] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!shift || hydrated) return;
    setStartTime(utcIsoToWallClockHHMM(shift.starts_at, shift.timezone));
    setEndTime(utcIsoToWallClockHHMM(shift.ends_at, shift.timezone));
    setNote(shift.note ?? '');
    setHydrated(true);
  }, [shift, hydrated]);

  const handleSave = async () => {
    if (!shift || updateShift.isPending) return;
    const starts_at = wallClockToUtcIso(
      shift.local_date,
      startTime,
      shift.timezone
    );
    // Overnight: if end wall clock is before start, treat end as next calendar day.
    let endDate = shift.local_date;
    if (endTime <= startTime) {
      const [y, m, d] = shift.local_date.split('-').map(Number);
      const next = new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 1);
      const yy = next.getFullYear();
      const mm = String(next.getMonth() + 1).padStart(2, '0');
      const dd = String(next.getDate()).padStart(2, '0');
      endDate = `${yy}-${mm}-${dd}`;
    }
    const ends_at = wallClockToUtcIso(endDate, endTime, shift.timezone);
    try {
      await updateShift.mutateAsync({
        shiftId: shift.id,
        input: {
          starts_at,
          ends_at,
          note: note.trim() || undefined,
        },
      });
    } catch {
      return;
    }
    showSuccessToast(t('detail.savedToast'));
    setHydrated(false);
  };

  if (shiftQuery.isLoading || onboarding.status === 'loading') {
    return (
      <View
        testID="shift-detail-loading"
        className="flex-1 items-center justify-center bg-background"
      >
        <LoadingIndicator />
      </View>
    );
  }

  if (!shift) {
    return (
      <View testID="shift-detail-missing" className="flex-1 bg-background p-6">
        <H1>{t('detail.missingTitle')}</H1>
        <Button
          testID="shift-detail-back"
          className="mt-4"
          onPress={() => router.back()}
        >
          <Text>{t('detail.back')}</Text>
        </Button>
      </View>
    );
  }

  return (
    <ScrollView
      testID="shift-detail-screen"
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100 }}
    >
      <H1 testID="shift-detail-title">{t('detail.title')}</H1>
      <Body className="mt-2 text-muted-foreground">
        {shift.local_date} · {shift.timezone}
      </Body>

      {isParent ? (
        <View className="mt-6 gap-4" testID="shift-detail-edit">
          <Body className="font-sora-medium">{t('detail.startLabel')}</Body>
          <Input
            testID="shift-detail-start"
            value={startTime}
            onChangeText={setStartTime}
            accessibilityLabel={t('detail.startLabel')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Body className="font-sora-medium">{t('detail.endLabel')}</Body>
          <Input
            testID="shift-detail-end"
            value={endTime}
            onChangeText={setEndTime}
            accessibilityLabel={t('detail.endLabel')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Body className="font-sora-medium">{t('detail.noteLabel')}</Body>
          <Textarea
            testID="shift-detail-note"
            value={note}
            onChangeText={setNote}
            accessibilityLabel={t('detail.noteLabel')}
          />
          <Button
            testID="shift-detail-save"
            disabled={updateShift.isPending}
            onPress={() => void handleSave()}
          >
            <Text>{t('detail.save')}</Text>
          </Button>
        </View>
      ) : (
        <View className="mt-6 gap-2" testID="shift-detail-readonly">
          <Body>
            {utcIsoToWallClockHHMM(shift.starts_at, shift.timezone)} –{' '}
            {utcIsoToWallClockHHMM(shift.ends_at, shift.timezone)}
          </Body>
          {shift.note ? <Body>{shift.note}</Body> : null}
        </View>
      )}

      <H2 className="mt-8">{t('detail.threadTitle')}</H2>
      <View testID="shift-detail-thread" className="mt-3 gap-3">
        {(eventsQuery.data ?? []).length === 0 ? (
          <Small testID="shift-detail-thread-empty">
            {t('detail.threadEmpty')}
          </Small>
        ) : (
          (eventsQuery.data ?? []).map(event => (
            <EventRow key={event.id} event={event} />
          ))
        )}
      </View>

      <Button
        testID="shift-detail-back"
        variant="outline"
        className="mt-8"
        onPress={() => router.back()}
      >
        <Text>{t('detail.back')}</Text>
      </Button>
    </ScrollView>
  );
}

function EventRow({ event }: { event: ShiftEvent }) {
  const { t } = useTranslation('schedule');
  const known = KNOWN_EVENT_TYPES.has(event.event_type);
  return (
    <View
      testID={`shift-event-${event.id}`}
      className="rounded-lg bg-muted p-3"
    >
      <Body className="font-sora-medium">
        {known
          ? t(`detail.eventType.${event.event_type}`, {
              defaultValue: event.event_type,
            })
          : t('detail.eventTypeUnknown')}
      </Body>
      <Small className="text-muted-foreground">{event.created_at}</Small>
      {!known ? (
        <Small testID={`shift-event-fallback-${event.id}`}>
          {t('detail.eventTypeFallback', { type: event.event_type })}
        </Small>
      ) : null}
    </View>
  );
}
