/**
 * Parent view of household carers' time off — TIER0-CX-SPEC.md §5.1's
 * "Mark N hours paid" entry point. Each row shows a real paid-status
 * `StatusPill` (never the raw `row.status` string) and, for a parent
 * editor, opens `MarkTimeOffPaidSheet` on tap.
 */
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { H1, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { HouseholdTimeOffRow } from '@/src/domains/timeOff/components/HouseholdTimeOffRow';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useHouseholdTimeOff } from '@/src/hooks/queries/useHouseholdTimeOff';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { localDateInZone } from '@/src/lib/localDate';
import { formatDateShort } from '@/src/utils/dateFormatting';

export default function HouseholdTimeOffScreen() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const active = useActiveHousehold();
  const timeOff = useHouseholdTimeOff(active.householdId);
  const members = useHouseholdMembers(active.householdId);
  const onboarding = useIsOnboarded();

  // Defense in depth — the server is the real gate (D12-class assertion in
  // `ptoCommandService.markTimeOffPaid`). A non-parent still sees the list
  // and its paid status, exactly as before; she just can't open the sheet.
  const canMarkPaid =
    isParentEditorRole(onboarding.role) && !onboarding.isPastMember;

  const rows = (timeOff.data ?? []).filter(r => r.status !== 'cancelled');

  // One line under the H1: how many bookings are still ahead, and the
  // soonest start. Hidden when nothing is booked (or everything is past) —
  // "0 days off coming up" would be a sentence with nothing true in it.
  const timezone = active.household?.timezone ?? 'UTC';
  const today = localDateInZone(timezone);
  const upcoming = rows.filter(
    row => localDateInZone(timezone, new Date(row.starts_at)) >= today
  );
  let nextDate: string | null = null;
  for (const row of upcoming) {
    const startDate = localDateInZone(timezone, new Date(row.starts_at));
    if (nextDate == null || startDate < nextDate) {
      nextDate = startDate;
    }
  }
  const timeOffSummary =
    nextDate == null
      ? null
      : t('householdTimeOff.summary', {
          count: upcoming.length,
          date: formatDateShort(nextDate),
        });

  const nameForCarer = (userId: string): string =>
    resolveCarerName(
      (members.data ?? []).find(m => m.user_id === userId),
      t('role.nanny')
    );

  return (
    <ScrollView
      testID="settings-household-time-off-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <BackButton onPress={() => router.back()} label={tCommon('back')} />
      <H1 className="mt-1">{t('carerTimeOff')}</H1>
      {timeOffSummary ? (
        <Small
          testID="household-time-off-summary"
          className="mt-1 text-muted-foreground"
        >
          {timeOffSummary}
        </Small>
      ) : null}
      <Small className="mt-1 text-muted-foreground">
        {t('carerTimeOffHint')}
      </Small>
      {timeOff.isLoading ? (
        <LoadingIndicator />
      ) : rows.length === 0 ? (
        <View testID="household-time-off-empty">
          <EmptyState
            variant="inline"
            title={t('carerTimeOffEmpty')}
            description=""
          />
        </View>
      ) : (
        <View className="mt-4 gap-2">
          {active.householdId
            ? rows.map(row => (
                <HouseholdTimeOffRow
                  key={row.id}
                  timeOff={row}
                  householdId={active.householdId as string}
                  carerName={nameForCarer(row.user_id)}
                  canMarkPaid={canMarkPaid}
                  householdTimezone={active.household?.timezone ?? 'UTC'}
                />
              ))
            : null}
        </View>
      )}
    </ScrollView>
  );
}
