/**
 * @module domains/schedule/components/ExtraShiftScreen
 *
 * Parent form to POST a one-off extra shift. Uses native date + TimeRangePicker
 * (not free-text) so malformed times cannot silently no-op via wallClockToUtcIso.
 */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { Button } from '@/src/components/ui/button';
import { ChildChip } from '@/src/components/ui/child-chip';
import { EmptyState } from '@/src/components/ui/empty-state';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { useHouseholdCarers } from '@/src/domains/schedule/hooks/useHouseholdCarers';
import { isExtraShiftFormValid } from '@/src/domains/schedule/utils/extraShiftForm';
import { isParentEditorRole } from '@/src/domains/setup/types';
import {
  formatDate,
  parseDate,
} from '@/src/domains/timeOff/components/TimeOffDateRangePicker.utils';
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
  const onboarding = useIsOnboarded();
  const active = useActiveHousehold();
  const timeZone = active.household?.timezone ?? 'UTC';
  const createExtra = useCreateExtraShift(active.householdId);
  const carers = useHouseholdCarers(active.householdId);
  const children = useChildren(active.householdId);

  const [date, setDate] = useState(() => localDateInZone(timeZone));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [carerId, setCarerId] = useState<string | null>(null);
  const [childIds, setChildIds] = useState<string[]>([]);

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

  const handleSubmit = async () => {
    if (!canSubmit || !active.householdId || !carerId) return;
    try {
      await createExtra.mutateAsync({
        starts_at: wallClockToUtcIso(date, start, timeZone),
        ends_at: wallClockToUtcIso(date, end, timeZone),
        timezone: timeZone,
        carer_id: carerId,
        child_ids: childIds.length > 0 ? childIds : undefined,
      });
      router.back();
    } catch (error) {
      // Mutation onError already toasts API failures; surface client-side throws.
      if (error instanceof Error && error.message) {
        showErrorToast(error.message);
      }
    }
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
          <Pressable
            testID="schedule-extra-shift-not-available-back"
            accessibilityRole="button"
            accessibilityLabel={tCommon('back')}
            onPress={() => router.back()}
            hitSlop={8}
            className="self-start"
          >
            <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
          </Pressable>
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
      <Pressable
        testID="schedule-extra-back"
        accessibilityRole="button"
        onPress={() => router.back()}
        className="self-start"
      >
        <Body className="text-primary">{`< ${tCommon('back')}`}</Body>
      </Pressable>
      <H1 className="mt-2">{t('shifts.extraScreenTitle')}</H1>
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
            const label =
              member.display_name_override?.trim() ||
              t('build.carerFallbackName');
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
    </ScrollView>
  );
}
