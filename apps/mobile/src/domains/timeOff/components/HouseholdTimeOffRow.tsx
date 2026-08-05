/**
 * @module domains/timeOff/components/HouseholdTimeOffRow
 *
 * TIER0-CX-SPEC.md §5.1 — one row on `household-time-off.tsx`: the date
 * range, a real paid/not-paid `StatusPill` (replacing the raw `row.status`
 * string the row used to print — an audit-class defect per the spec), and
 * the message. Tapping opens `MarkTimeOffPaidSheet`.
 *
 * Fetches its OWN ledger/balance/mutation (the `CarerPickerRow` pattern
 * from `PayArrangementScreen.tsx`: each row in a list is its own small
 * data-owning component, not lifted state in the parent list) so a list of
 * several carers' time off doesn't have to coordinate N carers' worth of
 * balances in one place.
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { MarkTimeOffPaidRequest } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { spacing } from '@/lib/design-tokens';
import { useElevation } from '@/lib/design-tokens/elevation';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, Small } from '@/src/components/ui/typography';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { useMarkTimeOffPaid } from '@/src/hooks/mutations/useMarkTimeOffPaid';
import { usePtoBalance } from '@/src/hooks/queries/usePtoBalance';
import { usePtoLedger } from '@/src/hooks/queries/usePtoLedger';
import { showSuccessToast } from '@/src/lib/toast';
import { formatTimeOffRangeLabel } from '../utils/timeOffDate';
import { MarkTimeOffPaidSheet } from './MarkTimeOffPaidSheet';

interface HouseholdTimeOffRowProps {
  timeOff: CarerTimeOff;
  householdId: string;
  /** Resolved once, by the caller, from `useHouseholdMembers` — this row is
   * inside the OWN household's view of its OWN nanny's time off, so a real
   * name is correct here (the anonymity rule is only for the nanny's
   * cross-family surface, TIER0-CX-SPEC.md §5.2, a different screen). */
  carerName: string;
  /** Parent-editor role gate (defense in depth — the server is the real
   * gate). A non-parent still sees the row and its paid status, just can't
   * open the mark-paid sheet. */
  canMarkPaid: boolean;
}

export function HouseholdTimeOffRow({
  timeOff,
  householdId,
  carerName,
  canMarkPaid,
}: HouseholdTimeOffRowProps) {
  const { t } = useTranslation('pay');
  const elevation = useElevation();
  const [sheetOpen, setSheetOpen] = useState(false);

  const year = new Date(timeOff.starts_at).getUTCFullYear();
  const ledger = usePtoLedger(householdId, timeOff.user_id, year);
  const balance = usePtoBalance(householdId, timeOff.user_id, year);
  const markPaid = useMarkTimeOffPaid(householdId, timeOff.user_id, year);

  const usageEntry =
    (ledger.data ?? []).find(
      entry => entry.kind === 'usage' && entry.time_off_id === timeOff.id
    ) ?? null;
  const paidHours = usageEntry ? Math.abs(usageEntry.minutes) / 60 : 0;

  const rangeLabel = formatTimeOffRangeLabel(
    timeOff.starts_at,
    timeOff.ends_at
  );

  const handlePress = () => {
    if (!canMarkPaid) return;
    setSheetOpen(true);
  };

  const handleSubmit = (input: MarkTimeOffPaidRequest) => {
    markPaid
      .mutateAsync(input)
      .then(() => {
        setSheetOpen(false);
        showSuccessToast(t('markPaidSheet.savedToast'));
      })
      // Failure already surfaced by the mutation's onError toast — the
      // sheet stays open with the typed values (ClockOutSheet discipline).
      .catch(() => undefined);
  };

  return (
    <>
      <AnimatedPressable
        testID={`household-time-off-${timeOff.id}`}
        accessibilityRole="button"
        onPress={handlePress}
      >
        <View
          className="gap-1 rounded-row bg-card px-4 py-3"
          style={[elevation.row, { minHeight: spacing.minTouchTarget }]}
        >
          <Body className="font-medium">
            {formatDisplayDate(timeOff.starts_at.slice(0, 10))}
            {' – '}
            {formatDisplayDate(timeOff.ends_at.slice(0, 10))}
          </Body>
          <StatusPill
            testID={`household-time-off-status-${timeOff.id}`}
            variant={usageEntry ? 'confirmed' : 'pending'}
            label={
              usageEntry
                ? t('householdTimeOff.paidBadge', { hours: paidHours })
                : t('householdTimeOff.notMarkedPaid')
            }
          />
          {timeOff.message ? (
            <Small className="text-muted-foreground">{timeOff.message}</Small>
          ) : null}
        </View>
      </AnimatedPressable>

      {canMarkPaid ? (
        <MarkTimeOffPaidSheet
          visible={sheetOpen}
          onDismiss={() => setSheetOpen(false)}
          onSubmit={handleSubmit}
          isSubmitting={markPaid.isPending}
          carerName={carerName}
          rangeLabel={rangeLabel}
          timeOffId={timeOff.id}
          balance={balance.data}
          existingUsageEntry={usageEntry}
        />
      ) : null}
    </>
  );
}
