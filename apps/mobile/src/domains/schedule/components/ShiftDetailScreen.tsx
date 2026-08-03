/**
 * @module domains/schedule/components/ShiftDetailScreen
 *
 * D23/D24 — single-shift detail: parent can edit wall-clock times + note;
 * nanny is read-only. Hosts the shift-scoped day thread.
 *
 * Wave B: the day-thread query (`useShiftEvents`) is keyed off `shift.household_id`
 * — the shift's OWN household, straight off the fetched record — not
 * `useIsOnboarded().householdId`/the switcher's active household. This
 * screen is reached by `shiftId` alone (deep link, push notification, or a
 * list elsewhere), and the shift always belongs to a specific household
 * regardless of which one a nanny with several currently has selected.
 */
import type { ShiftEvent } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H1, H2, Small } from '@/src/components/ui/typography';
import {
  shiftChangeRequestKindLabelKey,
  shiftChangeRequestStatusLabelKey,
} from '@/src/domains/schedule/constants/changeRequestKinds';
import { isParentEditorRole, SETUP_ROLES } from '@/src/domains/setup/types';
import { useCreateShiftChangeRequest } from '@/src/hooks/mutations/useCreateShiftChangeRequest';
import { useRespondToShiftChangeRequest } from '@/src/hooks/mutations/useRespondToShiftChangeRequest';
import { useUpdateShift } from '@/src/hooks/mutations/useUpdateShift';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { useShift } from '@/src/hooks/queries/useShift';
import { useShiftChangeRequests } from '@/src/hooks/queries/useShiftChangeRequests';
import { useShiftEvents } from '@/src/hooks/queries/useShiftEvents';
import { showSuccessToast } from '@/src/lib/toast';
import {
  shiftInstantsFromWallClock,
  utcIsoToWallClockHHMM,
} from '@/src/lib/wallClock';
import { useElevation } from '~/lib/design-tokens/elevation';

const KNOWN_EVENT_TYPES = new Set([
  'shift_updated',
  'pattern_conflict',
  'gap_raised',
]);

export function ShiftDetailScreen() {
  const { t } = useTranslation('schedule');
  const elevation = useElevation();
  const router = useRouter();
  const params = useLocalSearchParams<{ shiftId?: string }>();
  const shiftId = typeof params.shiftId === 'string' ? params.shiftId : null;
  const onboarding = useIsOnboarded();
  const shiftQuery = useShift(shiftId);
  const eventsQuery = useShiftEvents(shiftQuery.data?.household_id, shiftId);
  const updateShift = useUpdateShift();
  const createChange = useCreateShiftChangeRequest();
  const respondChange = useRespondToShiftChangeRequest();
  const changeRequests = useShiftChangeRequests(shiftId);

  const shift = shiftQuery.data;
  const isParent = isParentEditorRole(onboarding.role);
  const isNanny = onboarding.role === SETUP_ROLES.NANNY;
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
    // Overnight handling (end <= start rolls to the next calendar day) lives
    // in `shiftInstantsFromWallClock` — shared with the nanny counter-offer
    // below so the two can never disagree.
    const { starts_at, ends_at } = shiftInstantsFromWallClock(
      shift.local_date,
      startTime,
      endTime,
      shift.timezone
    );
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
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <H1 testID="shift-detail-title">{t('detail.title')}</H1>
      <Body className="mt-2 text-muted-foreground" tabular>
        {shift.local_date} · {shift.timezone}
      </Body>

      {isParent ? (
        <View className="mt-6 gap-4" testID="shift-detail-edit">
          <Body className="font-medium">{t('detail.startLabel')}</Body>
          <Input
            testID="shift-detail-start"
            value={startTime}
            onChangeText={setStartTime}
            accessibilityLabel={t('detail.startLabel')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Body className="font-medium">{t('detail.endLabel')}</Body>
          <Input
            testID="shift-detail-end"
            value={endTime}
            onChangeText={setEndTime}
            accessibilityLabel={t('detail.endLabel')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Body className="font-medium">{t('detail.noteLabel')}</Body>
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
          {shift.status !== 'cancelled' ? (
            <Button
              testID="shift-detail-cancel"
              variant="outline"
              disabled={createChange.isPending}
              onPress={() =>
                void createChange.mutateAsync({
                  shiftId: shift.id,
                  input: { kind: 'cancel' },
                })
              }
            >
              <Text>{t('detail.cancelShift')}</Text>
            </Button>
          ) : null}
        </View>
      ) : (
        <View className="mt-6 gap-2" testID="shift-detail-readonly">
          <Body tabular>
            {utcIsoToWallClockHHMM(shift.starts_at, shift.timezone)} –{' '}
            {utcIsoToWallClockHHMM(shift.ends_at, shift.timezone)}
          </Body>
          {shift.note ? <Body>{shift.note}</Body> : null}
          {isNanny ? (
            <View className="mt-4 gap-3" testID="shift-detail-counter-form">
              <Body className="font-medium">{t('detail.startLabel')}</Body>
              <Input
                testID="shift-detail-counter-start"
                value={startTime}
                onChangeText={setStartTime}
                accessibilityLabel={t('detail.startLabel')}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Body className="font-medium">{t('detail.endLabel')}</Body>
              <Input
                testID="shift-detail-counter-end"
                value={endTime}
                onChangeText={setEndTime}
                accessibilityLabel={t('detail.endLabel')}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                testID="shift-detail-counter"
                disabled={createChange.isPending}
                onPress={() => {
                  // Same overnight-aware builder the parent's Save uses —
                  // never two instants off the one `local_date`.
                  const { starts_at, ends_at } = shiftInstantsFromWallClock(
                    shift.local_date,
                    startTime,
                    endTime,
                    shift.timezone
                  );
                  void createChange.mutateAsync({
                    shiftId: shift.id,
                    input: {
                      kind: 'counter_offer',
                      proposed_starts_at: starts_at,
                      proposed_ends_at: ends_at,
                    },
                  });
                }}
              >
                <Text>{t('detail.counterOffer')}</Text>
              </Button>
            </View>
          ) : null}
        </View>
      )}

      {(changeRequests.data ?? []).length > 0 ? (
        <View testID="shift-detail-changes" className="mt-8 gap-3">
          <H2>{t('detail.changesTitle')}</H2>
          {(changeRequests.data ?? []).map(req => (
            <View
              key={req.id}
              className="gap-2 rounded-row bg-card p-3"
              style={elevation.row}
            >
              <Body className="font-medium">
                {t(shiftChangeRequestKindLabelKey(req.kind), {
                  defaultValue: req.kind,
                })}
              </Body>
              <Small className="text-muted-foreground">
                {t(shiftChangeRequestStatusLabelKey(req.status), {
                  defaultValue: req.status,
                })}
              </Small>
              {req.message ? (
                <Body testID={`shift-change-message-${req.id}`}>
                  {t('detail.requestMessageLabel')}: {req.message}
                </Body>
              ) : null}
              {req.response_message ? (
                <Body testID={`shift-change-response-${req.id}`}>
                  {t('detail.responseLabel')}: {req.response_message}
                </Body>
              ) : null}
              {req.status === 'pending' ? (
                <View className="flex-row gap-2">
                  <Button
                    testID={`shift-change-accept-${req.id}`}
                    disabled={respondChange.isPending}
                    onPress={() =>
                      void respondChange.mutateAsync({
                        changeRequestId: req.id,
                        input: { status: 'accepted' },
                      })
                    }
                  >
                    <Text>{t('detail.acceptChange')}</Text>
                  </Button>
                  <Button
                    testID={`shift-change-decline-${req.id}`}
                    variant="outline"
                    disabled={respondChange.isPending}
                    onPress={() =>
                      void respondChange.mutateAsync({
                        changeRequestId: req.id,
                        input: { status: 'declined' },
                      })
                    }
                  >
                    <Text>{t('detail.declineChange')}</Text>
                  </Button>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

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
      className="rounded-row bg-muted p-3"
    >
      <Body className="font-medium">
        {known
          ? t(`detail.eventType.${event.event_type}`, {
              defaultValue: event.event_type,
            })
          : t('detail.eventTypeUnknown')}
      </Body>
      <Small className="text-muted-foreground" tabular>
        {event.created_at}
      </Small>
      {!known ? (
        <Small testID={`shift-event-fallback-${event.id}`}>
          {t('detail.eventTypeFallback', { type: event.event_type })}
        </Small>
      ) : null}
    </View>
  );
}
