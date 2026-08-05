/**
 * @module domains/pay/components/MyPayScreen
 *
 * Surface B — "My pay" (TIER0-CX-SPEC.md §3), the nanny's read-only view:
 * one card per household she belongs to, each fetched independently through
 * `useCurrentPayArrangement`/`usePayArrangementHistory` for that household.
 * The subtitle sentence is the anonymity promise stated once, verbatim from
 * the spec — it is the whole reason `pto_ledger`/`pay_arrangements` never
 * carry a cross-household reference (docs/11-MONEY.md).
 *
 * Nanny-only, defense in depth (the settings.tsx row already gates this to
 * the nanny role, but the route is reachable by URL regardless) — a helper
 * or parent deep-linking here sees an honest not-available state, same
 * pattern as `ManageHouseholdScreen`'s.
 */

import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { EmptyState } from '@/src/components/ui/empty-state';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, H1, Small } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useCurrentPayArrangement } from '@/src/hooks/queries/useCurrentPayArrangement';
import { useHouseholds } from '@/src/hooks/queries/useHouseholds';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { usePayArrangementHistory } from '@/src/hooks/queries/usePayArrangementHistory';
import { usePtoBalance } from '@/src/hooks/queries/usePtoBalance';
import { localDateInZone } from '@/src/lib/localDate';
import { formatMoney, formatRate } from '@/src/lib/money';
import { useAuthStore } from '@/src/store/auth';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import { buildTermRows } from '../utils/termRows';
import { AmountRow } from './AmountRow';
import { BackRow } from './BackRow';

function MyPayHouseholdCard({
  household,
  carerId,
}: {
  household: Household;
  carerId: string;
}) {
  const { t } = useTranslation('pay');
  const current = useCurrentPayArrangement(household.id, carerId);
  const history = usePayArrangementHistory(household.id, carerId);
  const [historyOpen, setHistoryOpen] = useState(false);

  // This household's own local year — each card is per-family, so the
  // year the balance covers is THAT family's calendar, not the device's.
  const currentYear = Number(localDateInZone(household.timezone).slice(0, 4));
  const hasEntitlement = current.data?.pto_entitlement_minutes_per_year != null;
  const balance = usePtoBalance(
    household.id,
    carerId,
    hasEntitlement ? currentYear : undefined
  );

  return (
    <Card testID={`my-pay-household-${household.id}`}>
      <CardContent className="gap-3">
        <Body className="font-medium">{household.name}</Body>
        {current.isPending ? (
          <LoadingIndicator testID="my-pay-loading" />
        ) : !current.data ? (
          <View testID={`my-pay-empty-${household.id}`}>
            <EmptyState
              variant="inline"
              title={t('myPay.emptyTitle')}
              description={t('myPay.emptyDescription')}
            />
          </View>
        ) : (
          <>
            <View className="flex-row items-baseline gap-1">
              <H1 tabular>
                {formatMoney(current.data.rate_minor, current.data.currency)}
              </H1>
              <Body className="text-muted-foreground">/hr</Body>
            </View>
            <View className="gap-3">
              {buildTermRows(current.data, t, balance.data).map(row => (
                <AmountRow
                  key={row.key}
                  testID={`my-pay-term-${household.id}-${row.key}`}
                  label={row.label}
                  value={row.value}
                  valueWhenNull={row.valueWhenNull}
                  subLine={row.subLine}
                />
              ))}
            </View>
            <Small className="text-muted-foreground">
              {t('inEffectSince', {
                date: formatDisplayDateWithYear(current.data.valid_from),
              })}
            </Small>
            <Button
              testID={`my-pay-history-toggle-${household.id}`}
              variant="ghost"
              onPress={() => setHistoryOpen(open => !open)}
            >
              <Text>{t('myPay.historyButton')}</Text>
            </Button>
            {historyOpen ? (
              <View className="gap-2" testID={`my-pay-history-${household.id}`}>
                {(history.data ?? []).map(row => (
                  <View
                    key={row.id}
                    testID={`my-pay-history-row-${row.id}`}
                    className="gap-1 rounded-row bg-card px-4 py-3"
                  >
                    <Body className="font-medium" tabular>
                      {formatRate(row.rate_minor, row.currency)}
                    </Body>
                    <Small className="text-muted-foreground">
                      {t('historyFrom', {
                        date: formatDisplayDateWithYear(row.valid_from),
                      })}
                    </Small>
                    {row.note ? (
                      <Small className="text-muted-foreground">
                        {row.note}
                      </Small>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MyPayScreen() {
  const { t } = useTranslation('pay');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const households = useHouseholds();
  const userId = useAuthStore(s => s.user?.id ?? null);

  // A back affordance in EVERY state, including the transient loading one —
  // this screen is reachable straight from settings with no other way out
  // while it's still resolving (review finding 5).
  if (onboarding.status === 'loading') {
    return (
      <View testID="my-pay-screen" className="flex-1 bg-background">
        <View className="px-6 pt-8">
          <BackRow
            testID="my-pay-loading-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <LoadingIndicator testID="my-pay-loading" />
      </View>
    );
  }

  if (onboarding.role !== SETUP_ROLES.NANNY) {
    return (
      <View testID="my-pay-not-available" className="flex-1 bg-background">
        <View className="px-6 pt-8">
          <BackRow
            testID="my-pay-not-available-back"
            onPress={() => router.back()}
            label={tCommon('back')}
          />
        </View>
        <View className="mt-8 px-6">
          <EmptyState
            variant="inline"
            title={t('myPay.notAvailableTitle')}
            description={t('myPay.notAvailableDescription')}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      testID="my-pay-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
    >
      <BackRow
        testID="my-pay-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <H1 className="mt-2">{t('myPay.title')}</H1>
      <Small className="mt-1 text-muted-foreground">
        {t('myPay.subtitle')}
      </Small>

      {households.isPending ? (
        <LoadingIndicator testID="my-pay-loading" />
      ) : households.isError ? (
        <ErrorState variant="network" onRetry={() => households.refetch()} />
      ) : !userId ? null : (
        <View className="mt-4 gap-3">
          {households.data?.map(household => (
            <MyPayHouseholdCard
              key={household.id}
              household={household}
              carerId={userId}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
