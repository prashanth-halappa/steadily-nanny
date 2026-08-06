/**
 * @module domains/pay/components/PayArrangementScreen
 *
 * Surface A — "Pay & terms" (TIER0-CX-SPEC.md §2), parent-only. Serves both
 * routes: `/settings/pay` (no carer id — resolves from the household's
 * nanny members) and `/settings/pay/[carerId]` (the explicit second-nanny
 * case). One component for both, reading `carerId` from the route itself,
 * because the branching the spec describes ("one carer -> inline, two or
 * more -> a picker") only makes sense evaluated in one place.
 *
 * Amended per TIER0-PLAN.md owner decisions: no "Scheduled change" card
 * (`valid_from` is always today or earlier, so the current-terms card is
 * always the whole truth), and the append-only note moves to `Small` muted
 * copy directly above the History heading.
 */

import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { isParentEditorRole } from '@/src/domains/setup/types';
import { useCreatePayArrangement } from '@/src/hooks/mutations/useCreatePayArrangement';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { usePayArrangementHistory } from '@/src/hooks/queries/usePayArrangementHistory';
import { usePtoBalance } from '@/src/hooks/queries/usePtoBalance';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney, formatRate } from '@/src/lib/money';
import { showSuccessToast } from '@/src/lib/toast';
import { useElevation } from '~/lib/design-tokens/elevation';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import { buildTermRows } from '../utils/termRows';
import { AmountRow } from './AmountRow';
import { BackRow } from './BackRow';
import { PayChangeSheet } from './PayChangeSheet';

function normalizeParam(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Fallback chain: the member's own override -> the arrangement's
 * server-stored `carer_display_name` (real, profile-derived — never the
 * generic role label while an arrangement exists) -> the role label as a
 * last resort (review finding 8). `useHouseholdMembers` carries no
 * profile-derived name field beyond `display_name_override`, so the
 * arrangement is the only other honest source available here.
 */
function resolveCarerName(
  member: HouseholdMember | undefined,
  arrangementCarerDisplayName: string | undefined,
  roleFallback: string
): string {
  return (
    member?.display_name_override?.trim() ||
    arrangementCarerDisplayName?.trim() ||
    roleFallback
  );
}

function CarerPickerRow({
  householdId,
  carer,
  roleFallbackLabel,
  onPress,
}: {
  householdId: string;
  carer: HouseholdMember;
  roleFallbackLabel: string;
  onPress: () => void;
}) {
  const elevation = useElevation();
  const current = useCurrentPayArrangement(householdId, carer.user_id);
  const { t } = useTranslation('pay');
  const name = resolveCarerName(
    carer,
    current.data?.carer_display_name,
    roleFallbackLabel
  );

  return (
    <AnimatedPressable
      testID={`pay-carer-picker-${carer.user_id}`}
      accessibilityRole="button"
      accessibilityLabel={name}
      hitSlop={8}
      onPress={onPress}
    >
      <View
        className="flex-row items-center justify-between gap-3 rounded-row bg-card px-4 py-3"
        style={elevation.row}
      >
        <Body className="flex-1 text-primary">{name}</Body>
        {/* While the rate query is pending, render nothing rather than a
         * misleading "Not set" (review finding 7) — the PaySetupPromptCard's
         * isPending -> null discipline, applied to this rate label too. */}
        {current.isPending ? null : (
          <Small className="text-muted-foreground" tabular>
            {current.data
              ? formatRate(current.data.rate_minor, current.data.currency)
              : t('notSet')}
          </Small>
        )}
      </View>
    </AnimatedPressable>
  );
}

interface CarerPayDetailProps {
  householdId: string;
  householdTimezone: string;
  householdCancellationDefaultHours: number;
  carerId: string;
  /** The carer's own household-membership row, when resolved — the first
   * link in the display-name fallback chain (review finding 8). */
  carerMember: HouseholdMember | undefined;
  /** The role label to fall back to when neither the member's own override
   * nor the arrangement's stored name are available. */
  roleFallbackLabel: string;
  /** Only true when reached via the 2+ nanny picker — a single-nanny
   * household infers the carer from context, so repeating her name would be
   * redundant noise on an already-titled screen. */
  showCarerName: boolean;
  members: HouseholdMember[];
}

function CarerPayDetail({
  householdId,
  householdTimezone,
  householdCancellationDefaultHours,
  carerId,
  carerMember,
  roleFallbackLabel,
  showCarerName,
  members,
}: CarerPayDetailProps) {
  const { t } = useTranslation('pay');
  const router = useRouter();
  const current = useCurrentPayArrangement(householdId, carerId);
  const history = usePayArrangementHistory(householdId, carerId);
  const createArrangement = useCreatePayArrangement(householdId, carerId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const elevation = useElevation();

  // Household-local "today"'s year — called unconditionally (rules of
  // hooks), BEFORE `current` is known to have settled. `hasEntitlement`
  // reads `current.data` directly (not the later `arrangement` const, which
  // doesn't exist yet at this point in the render) so the balance query
  // only turns on once there is an entitlement to compute against
  // (TIER0-CX-SPEC.md §5.2: "no entitlement -> no balance is computed").
  const todayISO = localDateInZone(householdTimezone);
  const currentYear = Number(todayISO.slice(0, 4));
  const hasEntitlement = current.data?.pto_entitlement_minutes_per_year != null;
  const balance = usePtoBalance(
    householdId,
    carerId,
    hasEntitlement ? currentYear : undefined
  );

  if (current.isPending || history.isPending) {
    return <LoadingIndicator testID="pay-loading" />;
  }
  if (current.isError || history.isError) {
    return (
      <ErrorState
        variant="network"
        onRetry={() => {
          void current.refetch();
          void history.refetch();
        }}
      />
    );
  }

  const arrangement = current.data;
  // Resolved only once `current` has settled — the arrangement's stored
  // `carer_display_name` is the second link in the fallback chain (review
  // finding 8), and it isn't known any earlier than this.
  const carerName = resolveCarerName(
    carerMember,
    arrangement?.carer_display_name,
    roleFallbackLabel
  );

  const handleSubmit = (
    input: Parameters<typeof createArrangement.mutateAsync>[0]
  ) => {
    createArrangement
      .mutateAsync(input)
      .then(() => {
        setSheetOpen(false);
        showSuccessToast(t('changeSheet.savedToast'));
      })
      // Failure already surfaced by the mutation's onError toast — the sheet
      // stays open with the typed values (ClockOutSheet discipline).
      .catch(() => undefined);
  };

  return (
    <View className="mt-4 gap-4" testID={`pay-detail-${carerId}`}>
      {showCarerName ? <H4 testID="pay-carer-name">{carerName}</H4> : null}
      {!arrangement ? (
        <View testID="pay-empty-no-arrangement">
          <EmptyState
            variant="inline"
            image={illustrations.emptyPay}
            title={t('noArrangementTitle')}
            description={t('noArrangementDescription')}
            action={() => router.push(`/settings/pay/setup/${carerId}`)}
            actionLabel={t('setPayTermsAction')}
          />
        </View>
      ) : (
        <>
          <Card testID="pay-current-terms-card">
            <CardContent className="gap-3">
              <Small className="text-muted-foreground">
                {t('inEffectSince', {
                  date: formatDisplayDateWithYear(arrangement.valid_from),
                })}
              </Small>
              <View className="flex-row items-baseline gap-1">
                <H1 testID="pay-current-rate" tabular>
                  {formatMoney(arrangement.rate_minor, arrangement.currency)}
                </H1>
                <Body className="text-muted-foreground">/hr</Body>
              </View>
              <View className="gap-3">
                {buildTermRows(arrangement, t, balance.data).map(row => (
                  <AmountRow
                    key={row.key}
                    testID={`pay-term-${row.key}`}
                    label={row.label}
                    value={row.value}
                    valueWhenNull={row.valueWhenNull}
                    subLine={row.subLine}
                  />
                ))}
              </View>
              <Button
                testID="pay-change-terms-button"
                onPress={() => setSheetOpen(true)}
              >
                <Text>{t('changeTermsButton')}</Text>
              </Button>
            </CardContent>
          </Card>

          <Small className="text-muted-foreground">{t('appendOnlyNote')}</Small>

          <H4>{t('historyHeading')}</H4>
          <View className="gap-2" testID="pay-history-list">
            {history.data?.map(row => {
              const setByMember = row.created_by
                ? members.find(m => m.user_id === row.created_by)
                : undefined;
              const setByName = setByMember?.display_name_override?.trim();
              return (
                <View
                  key={row.id}
                  testID={`pay-history-${row.id}`}
                  className="gap-2 rounded-row bg-card px-4 py-3"
                  style={elevation.row}
                >
                  <Body weight="medium" tabular>
                    {formatRate(row.rate_minor, row.currency)}
                  </Body>
                  <Small className="text-muted-foreground">
                    {setByName
                      ? t('historyFromSetBy', {
                          date: formatDisplayDateWithYear(row.valid_from),
                          name: setByName,
                          createdDate: formatDisplayDateWithYear(
                            localDateInZone(
                              householdTimezone,
                              new Date(row.created_at)
                            )
                          ),
                        })
                      : t('historyFrom', {
                          date: formatDisplayDateWithYear(row.valid_from),
                        })}
                  </Small>
                  {row.note ? (
                    <Small className="text-muted-foreground">{row.note}</Small>
                  ) : null}
                </View>
              );
            })}
          </View>

          <PayChangeSheet
            visible={sheetOpen}
            onDismiss={() => setSheetOpen(false)}
            onSubmit={handleSubmit}
            isSubmitting={createArrangement.isPending}
            currentArrangement={arrangement}
            householdCancellationDefaultHours={
              householdCancellationDefaultHours
            }
            householdTimezone={householdTimezone}
            todayISO={todayISO}
          />
        </>
      )}
    </View>
  );
}

export function PayArrangementScreen() {
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const { t: tSettings } = useTranslation('settings');
  const router = useRouter();
  const params = useLocalSearchParams<{ carerId?: string | string[] }>();
  const carerIdParam = normalizeParam(params.carerId);

  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const householdId = activeHousehold.householdId;
  const members = useHouseholdMembers(householdId);

  const nannies = useMemo(
    () =>
      (members.data ?? []).filter(
        m => m.role === 'nanny' && m.status === 'active'
      ),
    [members.data]
  );

  if (onboarding.status === 'loading' || activeHousehold.isLoading) {
    return (
      <View testID="pay-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (!isParentEditorRole(onboarding.role)) {
    return (
      <View testID="pay-not-available" className="flex-1 bg-background">
        <ScrollView contentContainerStyle={SCREEN_CONTENT_STYLE}>
          <BackRow
            testID="pay-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
          <View className="mt-8">
            <EmptyState
              variant="inline"
              title={t('notAvailableTitle')}
              description={t('notAvailableDescription')}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!householdId || members.isPending) {
    return (
      <View testID="pay-screen" className="flex-1 bg-background">
        <LoadingIndicator testID="pay-loading" />
      </View>
    );
  }

  if (members.isError) {
    return <ErrorState variant="network" onRetry={() => members.refetch()} />;
  }

  const resolvedCarerId =
    carerIdParam ??
    (nannies.length === 1 ? (nannies[0]?.user_id ?? null) : null);
  const resolvedCarerMember = resolvedCarerId
    ? nannies.find(m => m.user_id === resolvedCarerId)
    : undefined;
  const household = activeHousehold.household;

  return (
    <ScrollView
      testID="pay-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <BackRow
        testID="pay-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1 testID="pay-title" className="mt-1">
        {t('title')}
      </H1>
      <Small className="mt-1 text-muted-foreground">{t('subtitle')}</Small>

      {!resolvedCarerId ? (
        nannies.length === 0 ? (
          <View className="mt-4" testID="pay-empty-no-carer">
            <EmptyState
              variant="inline"
              image={illustrations.emptyNoCarer}
              title={t('noCarerTitle')}
              description={t('noCarerDescription')}
              action={() => router.push('/settings/invite')}
              actionLabel={t('inviteAction')}
            />
          </View>
        ) : (
          <View className="mt-4 gap-2" testID="pay-carer-picker">
            {nannies.map(member => (
              <CarerPickerRow
                key={member.id}
                householdId={householdId}
                carer={member}
                roleFallbackLabel={tSettings('role.nanny')}
                onPress={() => router.push(`/settings/pay/${member.user_id}`)}
              />
            ))}
          </View>
        )
      ) : (
        <CarerPayDetail
          householdId={householdId}
          householdTimezone={household?.timezone ?? 'UTC'}
          householdCancellationDefaultHours={
            household?.cancellation_paid_within_hours ?? 0
          }
          carerId={resolvedCarerId}
          carerMember={resolvedCarerMember}
          roleFallbackLabel={tSettings('role.nanny')}
          showCarerName={nannies.length > 1}
          members={members.data ?? []}
        />
      )}
    </ScrollView>
  );
}
