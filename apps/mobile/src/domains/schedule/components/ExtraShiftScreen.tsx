/**
 * @module domains/schedule/components/ExtraShiftScreen
 *
 * Parent form to POST a one-off extra shift. Uses native date + TimeRangePicker
 * (not free-text) so malformed times cannot silently no-op via wallClockToUtcIso.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { availabilityApi } from '@/src/api/endpoints/availability';
import type { CreateExtraShiftInput } from '@/src/api/endpoints/changeRequests';
import { shiftApi } from '@/src/api/endpoints/shifts';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
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
import { ChildChip } from '@/src/components/ui/child-chip';
import { DateTimeField } from '@/src/components/ui/date-time-field';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { H1, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { isExtraShiftFormValid } from '@/src/domains/schedule/utils/extraShiftForm';
import {
  collectExtraShiftWarnings,
  type ExtraShiftWarning,
  findHouseholdOverlapShift,
  primaryExtraShiftWarning,
} from '@/src/domains/schedule/utils/extraShiftWarnings';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole } from '@/src/domains/setup/types';
import {
  formatDate,
  parseDate,
} from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
import { useCreateExtraShift } from '@/src/hooks/mutations/useCreateExtraShift';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCanWriteHousehold } from '@/src/hooks/queries/useCanWriteHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { addLocalDays, localDateInZone } from '@/src/lib/localDate';
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
  // No caller of this route (AgendaView, TodayCoverage, ScheduleShiftsScreen,
  // WeeklyHoursNotSetCard) passes a `householdId` param, and this screen
  // reads none — it always creates in whichever household is currently
  // active, so `active.householdId` IS this screen's own entity household,
  // not a stand-in for one it should have used instead.
  const canWriteHousehold = useCanWriteHousehold(active.householdId);
  const closedReason =
    !canWriteHousehold.isLoading && !canWriteHousehold.canWrite
      ? tCommon('householdClosedReason')
      : null;

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
  const [clashReason, setClashReason] = useState<ExtraShiftWarning | null>(
    null
  );
  const [clashHouseholdCarerId, setClashHouseholdCarerId] = useState<
    string | null
  >(null);
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
      !createExtra.isPending &&
      canWriteHousehold.canWrite,
    [
      date,
      start,
      end,
      carerId,
      active.householdId,
      createExtra.isPending,
      canWriteHousehold.canWrite,
    ]
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

  const carerFallback = t('shifts.extraClashCarerFallback');

  const clashDialogTitle = useMemo(() => {
    if (clashReason === 'past') {
      return t('shifts.extraPastTitle');
    }
    if (clashReason === 'householdOverlap') {
      const member = (carers.data ?? []).find(
        m => m.user_id === clashHouseholdCarerId
      );
      const name = member
        ? resolveCarerName(member, carerFallback)
        : carerFallback;
      return t('shifts.extraHouseholdOverlapTitle', { name });
    }
    const name = selectedCarer
      ? resolveCarerName(selectedCarer, carerFallback)
      : carerFallback;
    return t('shifts.extraClashTitle', { name });
  }, [
    clashReason,
    carers.data,
    clashHouseholdCarerId,
    selectedCarer,
    carerFallback,
    t,
  ]);

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
    setClashReason(null);
    setClashHouseholdCarerId(null);
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
      const dayFrom = wallClockToUtcIso(date, '00:00', timeZone);
      const dayTo = wallClockToUtcIso(addLocalDays(date, 1), '00:00', timeZone);
      let busyBlocks: Awaited<
        ReturnType<typeof availabilityApi.getBusyBlocks>
      > = [];
      let shifts: Awaited<ReturnType<typeof shiftApi.range>> = [];

      await Promise.all([
        availabilityApi
          .getBusyBlocks(carerId, payload.starts_at, payload.ends_at)
          .then(result => {
            busyBlocks = result;
          })
          .catch(() => {}),
        shiftApi
          .range(active.householdId, dayFrom, dayTo)
          .then(result => {
            shifts = result;
          })
          .catch(() => {}),
      ]);

      const { sameCarerConflict, warnings } = collectExtraShiftWarnings({
        startsAt: payload.starts_at,
        endsAt: payload.ends_at,
        nowIso: new Date().toISOString(),
        carerId,
        shifts,
        busyBlocks,
      });

      if (sameCarerConflict) {
        const name = selectedCarer
          ? resolveCarerName(selectedCarer, t('shifts.extraClashCarerFallback'))
          : t('shifts.extraClashCarerFallback');
        showErrorToast(t('shifts.extraSameCarerConflict', { name }));
        return;
      }

      const reason = primaryExtraShiftWarning(warnings);
      if (reason) {
        const overlap = findHouseholdOverlapShift(
          payload.starts_at,
          payload.ends_at,
          carerId,
          shifts
        );
        setClashHouseholdCarerId(overlap?.carer_id ?? null);
        setClashReason(reason);
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
        <DateTimeField
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

        <RestrictedActionButton
          testID="schedule-extra-submit"
          className="mt-2"
          label={t('shifts.extraSubmit')}
          reason={closedReason}
          disabled={!canSubmit || canWriteHousehold.isLoading}
          onPress={() => void handleSubmit()}
        />
      </View>

      <AlertDialog open={clashOpen} onOpenChange={setClashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{clashDialogTitle}</AlertDialogTitle>
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
