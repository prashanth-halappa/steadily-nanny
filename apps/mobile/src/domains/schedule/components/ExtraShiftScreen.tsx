/**
 * @module domains/schedule/components/ExtraShiftScreen
 *
 * Parent form to POST a one-off extra shift. Uses native date + TimeRangePicker
 * (not free-text) so malformed times cannot silently no-op via wallClockToUtcIso.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { availabilityApi } from '@/src/api/endpoints/availability';
import type { CreateExtraShiftInput } from '@/src/api/endpoints/changeRequests';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { H1, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { isExtraShiftFormValid } from '@/src/domains/schedule/utils/extraShiftForm';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole } from '@/src/domains/setup/types';
import {
  formatDate,
  parseDate,
} from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
import { findConflictingBusyBlocks } from '@/src/domains/timeOff/utils/busyConflict';
import { useCreateExtraShift } from '@/src/hooks/mutations/useCreateExtraShift';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { localDateInZone } from '@/src/lib/localDate';
import { showErrorToast } from '@/src/lib/toast';
import { wallClockToUtcIso } from '@/src/lib/wallClock';

export function ExtraShiftScreen() {
  const { t } = useTranslation('schedule');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const params = useLocalSearchParams<{
    date?: string;
    start?: string;
    end?: string;
    carerId?: string;
    childId?: string;
  }>();
  const onboarding = useIsOnboarded();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const createExtra = useCreateExtraShift(active.householdId);
  const carers = useHouseholdCarers(active.householdId);
  const children = useChildren(active.householdId);

  const [date, setDate] = useState(
    () =>
      (typeof params.date === 'string' && params.date) ||
      localDateInZone(timeZone)
  );
  const [start, setStart] = useState(
    () => (typeof params.start === 'string' && params.start) || '09:00'
  );
  const [end, setEnd] = useState(
    () => (typeof params.end === 'string' && params.end) || '17:00'
  );
  const [carerId, setCarerId] = useState<string | null>(
    () => (typeof params.carerId === 'string' && params.carerId) || null
  );
  const [childIds, setChildIds] = useState<string[]>(() =>
    typeof params.childId === 'string' && params.childId.length > 0
      ? [params.childId]
      : []
  );
  const [clashOpen, setClashOpen] = useState(false);
  const [pendingPayload, setPendingPayload] =
    useState<CreateExtraShiftInput | null>(null);

  useEffect(() => {
    const rows = carers.data ?? [];
    if (rows.length === 1 && !carerId) {
      setCarerId(rows[0]?.user_id ?? null);
    }
  }, [carers.data, carerId]);

  useEffect(() => {
    if (childIds.length === 0 && (children.data?.length ?? 0) > 0) {
      setChildIds((children.data ?? []).map(c => c.id));
    }
  }, [children.data, childIds.length]);

  const canSubmit = useMemo(
    () =>
      isExtraShiftFormValid({ date, start, end, carerId }) &&
      !!active.householdId &&
      !createExtra.isPending,
    [date, start, end, carerId, active.householdId, createExtra.isPending]
  );

  const toggleChild = (id: string) => {
    setChildIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleDateChange = (_event: unknown, next?: Date) => {
    if (!next) return;
    setDate(formatDate(next));
  };

  const selectedCarer = useMemo(
    () => (carers.data ?? []).find(member => member.user_id === carerId),
    [carers.data, carerId]
  );

  const submitPayload = async (payload: CreateExtraShiftInput) => {
    try {
      await createExtra.mutateAsync(payload);
      router.back();
    } catch (error) {
      // Mutation onError already toasts API failures; surface client-side throws.
      const err = error as { isAxiosError?: boolean; response?: unknown };
      if (err.isAxiosError || err.response) {
        return;
      }
      if (error instanceof Error && error.message) {
        showErrorToast(error.message);
      }
    }
  };

  const confirmPending = () => {
    const payload = pendingPayload;
    if (!payload) return;
    setClashOpen(false);
    setPendingPayload(null);
    void submitPayload(payload);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !active.householdId || !carerId) return;
    const payload: CreateExtraShiftInput = {
      starts_at: wallClockToUtcIso(date, start, timeZone),
      ends_at: wallClockToUtcIso(date, end, timeZone),
      timezone: timeZone,
      carer_id: carerId,
      child_ids: childIds.length > 0 ? childIds : undefined,
    };

    try {
      const busyBlocks = await availabilityApi.getBusyBlocks(
        carerId,
        payload.starts_at,
        payload.ends_at
      );
      const conflicts = findConflictingBusyBlocks(
        payload.starts_at,
        payload.ends_at,
        busyBlocks
      );
      if (conflicts.length > 0) {
        setPendingPayload(payload);
        setClashOpen(true);
        return;
      }
    } catch {
      // Advisory only — never block creation on a lookup failure.
    }

    await submitPayload(payload);
  };

  // Parent-only, same guard the siblings (SchedulePendingScreen,
  // ScheduleBuildScreen) use. This screen used to rely entirely on the
  // parent-gated button that reaches it — the server rejects a nanny, but
  // the client happily rendered the form and only failed on submit.
  if (!isParentEditorRole(onboarding.role)) {
    return (
      <View
        testID="schedule-extra-shift-not-available"
        className="flex-1 bg-background"
      >
        <View
          style={{
            paddingHorizontal: SCREEN_CONTENT_STYLE.padding,
            paddingTop: SCREEN_CONTENT_STYLE.padding,
          }}
        >
          <BackButton
            testID="schedule-extra-shift-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <View
          className="mt-8"
          style={{ paddingHorizontal: SCREEN_CONTENT_STYLE.padding }}
        >
          <EmptyState
            variant="inline"
            title={t('shifts.extraNotAvailableTitle')}
            description={t('shifts.extraNotAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      testID="schedule-extra-shift-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <BackButton
        testID="schedule-extra-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1 className="mt-1">{t('shifts.extraScreenTitle')}</H1>
      <View className="mt-4 gap-3">
        <Small className="text-muted-foreground">
          {t('shifts.extraDateLabel')}
        </Small>
        <DateTimePicker
          testID="schedule-extra-date"
          mode="date"
          value={parseDate(date)}
          onChange={handleDateChange}
        />

        <TimeRangePicker
          testID="schedule-extra-times"
          start={start}
          end={end}
          onChange={(nextStart, nextEnd) => {
            setStart(nextStart);
            setEnd(nextEnd);
          }}
        />

        <Small className="text-muted-foreground">
          {t('shifts.extraCarerLabel')}
        </Small>
        <View className="flex-row flex-wrap gap-2">
          {(carers.data ?? []).map(member => {
            const selected = member.user_id === carerId;
            const label = resolveCarerName(
              member,
              t('build.carerFallbackName')
            );
            return (
              <Pressable
                key={member.user_id}
                testID={`schedule-extra-carer-${member.user_id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setCarerId(member.user_id)}
                className={
                  selected
                    ? 'rounded-chip bg-primary px-3 py-1.5'
                    : 'rounded-chip bg-secondary px-3 py-1.5'
                }
              >
                <Text
                  className={
                    selected ? 'text-primary-foreground' : 'text-foreground'
                  }
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {(children.data?.length ?? 0) > 0 ? (
          <>
            <Small className="text-muted-foreground">
              {t('shifts.extraChildrenLabel')}
            </Small>
            <View className="flex-row flex-wrap gap-2">
              {(children.data ?? []).map(child => (
                <ChildChip
                  key={child.id}
                  testID={`schedule-extra-child-${child.id}`}
                  name={child.name}
                  colour={child.colour ?? undefined}
                  selected={childIds.includes(child.id)}
                  onPress={() => toggleChild(child.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        <Button
          testID="schedule-extra-submit"
          className="mt-2"
          disabled={!canSubmit}
          onPress={() => void handleSubmit()}
        >
          <Text className="text-primary-foreground font-medium">
            {t('shifts.extraSubmit')}
          </Text>
        </Button>
      </View>

      <AlertDialog open={clashOpen} onOpenChange={setClashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('shifts.extraClashTitle', {
                name: selectedCarer
                  ? resolveCarerName(
                      selectedCarer,
                      t('shifts.extraClashCarerFallback')
                    )
                  : t('shifts.extraClashCarerFallback'),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('shifts.extraClashDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel testID="schedule-extra-clash-cancel">
              <Text>{t('shifts.extraClashCancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID="schedule-extra-clash-confirm"
              onPress={confirmPending}
            >
              <Text>{t('shifts.extraClashConfirm')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollView>
  );
}
