/**
 * @module domains/timesheet/components/PaymentsScreen
 *
 * Every payment recorded for one household, newest first, grouped by
 * settlement month. Reached from Hours as a pushed route — a sibling of
 * `(tabs)`, so it covers the tab bar and needs no tab-bar scroll padding
 * (same reasoning as `InboxScreen`).
 *
 * THIS SCREEN IS A RECORD, NOT A TO-DO LIST. Its ceiling is L4: no tinted
 * ground, no `Card tone`, no filled primary, no apricot (apricot means
 * someone is on the clock, and a settled payment is the opposite). The only
 * actions a payments screen could plausibly offer — "pay this", "chase this"
 * — are both out of scope, and inventing an L1 for a screen with nothing to
 * do on it would teach people to ignore the rung that matters elsewhere.
 *
 * ARITHMETIC lives in `utils/paymentGroups`, and there is deliberately none
 * here: a month holding two currencies renders two figures, never a sum. The
 * app has no FX rate (docs/11-MONEY.md §4) and collapsing them would invent
 * one.
 *
 * WEEK ATTRIBUTION is a client-side join, not a wire change. `Payment` rows
 * carry `timesheet_id` but neither a `week_start` nor a carer name; the
 * household's timesheet list already carries both, so one `useMemo` keyed by
 * `timesheet_id` supplies them. A payment whose timesheet is absent still
 * renders — minus the week and carer lines. An omitted line is honest; a
 * fabricated range on a money screen is not.
 *
 * ROLE comes from `useIsOnboarded()` (server-derived, never a local flag) and
 * changes exactly three things: the subtitle, whether the row names who was
 * paid, and whether the leaf sheet does.
 */
import { FlashList } from '@shopify/flash-list';
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Download } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { AnimatedPressable } from '@/lib/animations';
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { spacing } from '@/lib/design-tokens/spacing';
import { Icon } from '@/lib/icons/iconWithClassName';
import { timesheetApi } from '@/src/api/endpoints/timesheets';
import { queryKeys } from '@/src/api/queryKeys';
import { ErrorState } from '@/src/components/custom/ErrorState';
import { BackButton } from '@/src/components/ui/back-button';
import { EmptyState } from '@/src/components/ui/empty-state';
import { ScreenWash } from '@/src/components/ui/screen-wash';
import { SkeletonShimmer } from '@/src/components/ui/skeleton-shimmer';
import {
  Caption,
  DayGroup,
  Figure,
  H1,
  MetadataLabel,
  Small,
} from '@/src/components/ui/typography';
import { HouseholdSwitcher } from '@/src/domains/household/components/HouseholdSwitcher';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { canViewParentSchedule } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useHouseholdPayments } from '@/src/hooks/queries/useHouseholdPayments';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import i18n from '@/src/i18n';
import { formatMoney } from '@/src/lib/money';
import { showErrorToast } from '@/src/lib/toast';
import {
  formatEarningsLongDate,
  formatEarningsSpanDate,
} from '../utils/earningsFormat';
import {
  type CurrencySubtotal,
  groupPaymentsByMonth,
} from '../utils/paymentGroups';
import { buildPaymentsCsv, type PaymentCsvRow } from '../utils/paymentsCsv';
import { formatWeekRangeLabel, getWeekDates } from '../utils/week';
import {
  ExportUnavailableError,
  shareCsv,
  weekExportFileName,
} from '../utils/weekExport';
import { type ExportKind, ExportWeekSheet } from './ExportWeekSheet';
import { PaymentDetailSheet } from './PaymentDetailSheet';
import { PaymentRow, type PaymentRowData } from './PaymentRow';

const SKELETON_ROWS = [0, 1, 2];
const MS_PER_DAY = 86_400_000;

/** Flat discriminated union, same shape as `AgendaView`'s — one list, two
 * item kinds, `getItemType` keyed off the tag. */
type PaymentsItem =
  | {
      type: 'month-header';
      key: string;
      monthKey: string;
      subtotals: readonly CurrencySubtotal[];
    }
  | { type: 'payment'; key: string; row: PaymentRowData };

/** What the timesheet list contributes to a payment row. */
interface WeekAttribution {
  weekStart: string;
  carerName: string;
}

/** '2026-08' -> "August 2026", in the app's CURRENT language. Anchored to
 * UTC so the month can never slip across a boundary the way a device-zone
 * `Date` would. */
function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat(i18n.language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1)));
}

/**
 * Did the entry trail the money by more than one day?
 *
 * `paid_at` is a DATE ('2026-08-16'); `created_at` is an instant. Both are
 * reduced to their own calendar date BEFORE comparing, so a payment recorded
 * at 23:45 on the day it moved is not reported a day late by a timezone
 * shift. One day of lag is ordinary life; two is worth saying out loud.
 */
function isEnteredLate(paidAt: string, createdAtISO: string): boolean {
  const paid = Date.parse(`${paidAt}T00:00:00Z`);
  const recorded = Date.parse(`${createdAtISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(paid) || Number.isNaN(recorded)) return false;
  return (recorded - paid) / MS_PER_DAY > 1;
}

/** A skeleton must match the rung it becomes (daylight-v2.md §6.9): one
 * group header, then three bare L4 rows. */
function PaymentsSkeleton() {
  return (
    <View testID="payments-loading" className="pt-2">
      <View className="pt-6 pb-2">
        <SkeletonShimmer
          testID="payments-month-skeleton"
          width="45%"
          height={16}
        />
      </View>
      {SKELETON_ROWS.map(index => (
        <View
          key={index}
          className="mb-2 justify-center rounded-row bg-card px-4 py-3"
          style={{ minHeight: 56 }}
        >
          <SkeletonShimmer
            testID={`payments-row-skeleton-${index}`}
            width="55%"
            height={14}
          />
        </View>
      ))}
    </View>
  );
}

function MonthHeader({
  monthKey,
  subtotals,
  recordedLabel,
}: {
  monthKey: string;
  subtotals: readonly CurrencySubtotal[];
  recordedLabel: string;
}) {
  return (
    <View
      testID={`payments-month-${monthKey}`}
      className="flex-row items-center justify-between gap-3 pt-6 pb-2"
    >
      <DayGroup testID={`payments-month-${monthKey}-title`}>
        {formatMonthLabel(monthKey)}
      </DayGroup>
      <View className="flex-row items-center gap-2">
        {/* Rule M — a metadata label on the wash reads muted-STRONG. */}
        <MetadataLabel
          testID={`payments-month-${monthKey}-label`}
          className="text-muted-strong"
        >
          {recordedLabel}
        </MetadataLabel>
        {/* Two currencies in a month means two figures. Never a sum. */}
        <View className="items-end">
          {subtotals.map(subtotal => (
            <Figure
              key={subtotal.currency}
              testID={`payments-month-${monthKey}-total-${subtotal.currency}`}
              weight="medium"
            >
              {formatMoney(subtotal.totalMinor, subtotal.currency)}
            </Figure>
          ))}
        </View>
      </View>
    </View>
  );
}

export function PaymentsScreen() {
  const { t } = useTranslation('hours');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const onboarding = useIsOnboarded();
  const active = useActiveHousehold();
  const householdId = active.householdId;
  const isParentSide = canViewParentSchedule(onboarding.role);

  const payments = useHouseholdPayments(householdId);
  const members = useHouseholdMembers(householdId);
  // The join's other half. Inline rather than its own hook because nothing
  // else needs a whole-household timesheet list, and `queryKeys.timesheet.list`
  // already names exactly this read.
  const timesheets = useQuery({
    queryKey: queryKeys.timesheet.list(householdId ?? undefined),
    queryFn: () => timesheetApi.list(householdId as string),
    staleTime: QUERY_TIMING.STALE_1M,
    enabled: !!householdId,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isExportSheetVisible, setIsExportSheetVisible] = useState(false);
  const [exportBusyKind, setExportBusyKind] = useState<ExportKind | null>(null);

  const attributionByTimesheetId = useMemo(() => {
    const map = new Map<string, WeekAttribution>();
    for (const timesheet of timesheets.data ?? []) {
      map.set(timesheet.id, {
        weekStart: timesheet.week_start,
        carerName: timesheet.carer_display_name,
      });
    }
    return map;
  }, [timesheets.data]);

  const items = useMemo<PaymentsItem[]>(() => {
    const list: PaymentsItem[] = [];
    for (const group of groupPaymentsByMonth(payments.data ?? [])) {
      list.push({
        type: 'month-header',
        key: `month-${group.monthKey}`,
        monthKey: group.monthKey,
        subtotals: group.subtotals,
      });
      for (const payment of group.payments) {
        const joined = attributionByTimesheetId.get(payment.timesheet_id);
        // Both halves of the meta line are optional, and a payment with
        // neither gets no line at all rather than a stray separator.
        const metaParts = [
          joined && isParentSide
            ? t('payments.rowPaidTo', { name: joined.carerName })
            : null,
          payment.method_note,
        ].filter((part): part is string => !!part);

        list.push({
          type: 'payment',
          key: `payment-${payment.id}`,
          row: {
            id: payment.id,
            dateLabel: formatEarningsSpanDate(payment.paid_at),
            amountLabel: formatMoney(payment.amount_minor, payment.currency),
            weekLabel: joined
              ? t('payments.rowWeek', {
                  range: formatWeekRangeLabel(getWeekDates(joined.weekStart)),
                })
              : null,
            metaLabel: metaParts.length > 0 ? metaParts.join(' · ') : null,
            enteredLateLabel: isEnteredLate(payment.paid_at, payment.created_at)
              ? t('payments.rowEnteredLate', {
                  date: formatEarningsLongDate(payment.created_at.slice(0, 10)),
                })
              : null,
          },
        });
      }
    }
    return list;
  }, [payments.data, attributionByTimesheetId, isParentSide, t]);

  // Same join `items` uses, flattened in the same newest-first order the
  // list renders — the CSV performs no sorting of its own (`paymentsCsv.ts`).
  const handleShareCsv = async () => {
    if (exportBusyKind) return;
    setExportBusyKind('csv');
    try {
      const rows: PaymentCsvRow[] = groupPaymentsByMonth(
        payments.data ?? []
      ).flatMap(group =>
        group.payments.map(payment => {
          const joined = attributionByTimesheetId.get(payment.timesheet_id);
          return {
            paid_at: payment.paid_at,
            week_start: joined?.weekStart ?? null,
            carer: joined?.carerName ?? null,
            amount_minor: payment.amount_minor,
            currency: payment.currency,
            method_note: payment.method_note,
            recorded_by: payment.recorded_by,
            created_at: payment.created_at,
          };
        })
      );
      await shareCsv(
        weekExportFileName(
          'Payments',
          new Date().toISOString().slice(0, 10),
          'csv'
        ),
        buildPaymentsCsv(rows),
        t('payments.exportTitle')
      );
      setIsExportSheetVisible(false);
    } catch (error) {
      showErrorToast(
        error instanceof ExportUnavailableError
          ? t('export.unavailable')
          : t('export.failed')
      );
    } finally {
      setExportBusyKind(null);
    }
  };

  const selected: Payment | null =
    payments.data?.find(payment => payment.id === selectedId) ?? null;
  const selectedAttribution = selected
    ? (attributionByTimesheetId.get(selected.timesheet_id) ?? null)
    : null;
  // Never a raw uuid: an unresolvable recorder reads as "no longer in this
  // household", which is what a nulled/absent membership actually means.
  const recordedByName = useMemo(() => {
    if (!selected?.recorded_by) return null;
    const member = (members.data ?? []).find(
      row => row.user_id === selected.recorded_by
    );
    return member
      ? resolveCarerName(member, t('payments.detail.recordedByGone'))
      : null;
  }, [selected, members.data, t]);

  const header = (
    <View className="gap-1 pb-2">
      <BackButton
        testID="payments-back"
        onPress={() => router.back()}
        label={tCommon('back')}
      />
      <View className="flex-row items-center justify-between gap-3">
        <H1 testID="payments-title">{t('payments.screenTitle')}</H1>
        {/* L4 — an icon, not a filled button; this screen is a record and
            deliberately carries no L1. */}
        <AnimatedPressable
          testID="payments-export-button"
          accessibilityRole="button"
          accessibilityLabel={t('payments.exportButton')}
          haptic="light"
          scaleIntensity="subtle"
          onPress={() => setIsExportSheetVisible(true)}
          hitSlop={12}
          style={{
            minWidth: spacing.minTouchTarget,
            minHeight: spacing.minTouchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon icon={Download} size={20} className="text-primary" />
        </AnimatedPressable>
      </View>
      {/* Rule M — Small on the wash reads muted-STRONG. */}
      <Small testID="payments-subtitle" className="text-muted-strong">
        {t(isParentSide ? 'payments.subtitleParent' : 'payments.subtitleNanny')}
      </Small>
      {/* Self-sources and self-hides at one household — no props. */}
      <HouseholdSwitcher />
      {active.isPastHousehold ? (
        <Caption testID="payments-read-only" className="text-muted-strong">
          {t('payments.readOnlyNote')}
        </Caption>
      ) : null}
    </View>
  );

  const notes = (
    <View testID="payments-notes" className="gap-1 pt-6">
      <Caption className="text-muted-strong">
        {t('payments.noPaymentWeeksNote')}
      </Caption>
      <Caption className="text-muted-strong">
        {t('payments.reimbursementsNote')}
      </Caption>
      <Caption className="text-muted-strong">{t('paid.note')}</Caption>
    </View>
  );

  // CSV only: there is no PDF statement for the ledger yet, so `onSharePdf`
  // is OMITTED and the sheet hides that option. A visible button wired to a
  // no-op would be a dead affordance on a money surface.
  const exportSheet = (
    <ExportWeekSheet
      testID="payments-export"
      visible={isExportSheetVisible}
      onDismiss={() => setIsExportSheetVisible(false)}
      onShareCsv={() => void handleShareCsv()}
      busyKind={exportBusyKind}
      subtitleLabel={t('payments.screenTitle')}
      titleLabel={t('payments.exportTitle')}
      csvHintLabel={t('payments.exportCsvHint')}
    />
  );

  const sheet = (
    <PaymentDetailSheet
      visible={selected !== null}
      onDismiss={() => setSelectedId(null)}
      payment={selected}
      weekStart={selectedAttribution?.weekStart ?? null}
      paidToName={
        isParentSide ? (selectedAttribution?.carerName ?? null) : null
      }
      recordedByName={recordedByName}
    />
  );

  // Loading, error and empty all keep the header — the title and the back
  // button are derived locally and must never wait on a request.
  if (payments.isPending || payments.isError || items.length === 0) {
    return (
      <View testID="payments-screen" className="flex-1 bg-background">
        <ScreenWash kind="brand" />
        <ScrollView contentContainerStyle={SCREEN_CONTENT_STYLE}>
          {header}
          {payments.isError ? (
            <View testID="payments-error">
              <ErrorState
                variant="network"
                onRetry={() => {
                  payments.refetch();
                }}
              />
            </View>
          ) : payments.isPending ? (
            <PaymentsSkeleton />
          ) : (
            // No figure at all: nothing recorded is not the same as zero.
            <View testID="payments-empty">
              <EmptyState
                variant="inline"
                image={illustrations.emptyPay}
                title={t('payments.emptyTitle')}
                description={t(
                  isParentSide
                    ? 'payments.emptyBodyParent'
                    : 'payments.emptyBodyNanny'
                )}
              />
            </View>
          )}
        </ScrollView>
        {exportSheet}
      </View>
    );
  }

  return (
    <View testID="payments-screen" className="flex-1 bg-background">
      <ScreenWash kind="brand" />
      <FlashList
        testID="payments-list"
        data={items}
        keyExtractor={item => item.key}
        getItemType={item => item.type}
        ListHeaderComponent={header}
        ListFooterComponent={notes}
        contentContainerStyle={SCREEN_CONTENT_STYLE}
        renderItem={({ item }) => {
          if (item.type === 'month-header') {
            return (
              <MonthHeader
                monthKey={item.monthKey}
                subtotals={item.subtotals}
                recordedLabel={t('payments.recordedLabel')}
              />
            );
          }
          if (item.type === 'payment') {
            return (
              <PaymentRow
                row={item.row}
                onPress={() => setSelectedId(item.row.id)}
              />
            );
          }
          const exhaustive: never = item;
          return exhaustive;
        }}
      />
      {/* Outside the list on purpose — dismissal must never depend on which
          row happens to be mounted. */}
      {sheet}
      {exportSheet}
    </View>
  );
}
