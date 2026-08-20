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
 *
 * GATED ON THE LEDGER/BALANCE READS (D-B1, fixed —
 * docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B's compound finding): while either
 * `usePtoLedger`/`usePtoBalance` is pending the row shows no pill at all
 * (neutral, not "Not marked paid"); on either failing it shows an inline
 * retry instead of a stale pill. The row is NOT pressable into the payment
 * sheet in either state — a tap during either window used to open
 * `MarkTimeOffPaidSheet` with `existingUsageEntry: null`, inviting a second
 * payment record over one that may already exist.
 *
 * PAID-NESS IS NETTED, NOT PRESENCE-BASED (Phase 3+4 adversarial review,
 * finding 2): `pto_ledger` is append-only — cancelling a time off that was
 * already marked paid never deletes the `usage` row, it inserts a
 * REVERSING `adjustment` row carrying the same `time_off_id`
 * (`ptoCommandService.reconcileCancelledTimeOff`). A "paid" pill driven by
 * "does a usage row exist" therefore keeps reading paid forever, even after
 * a full reversal. `netPaidMinutesForTimeOff` nets every usage/adjustment
 * row for this time off before deciding — see that module's doc for the
 * fully/partially-reversed cases.
 *
 * YEAR IS HOUSEHOLD-LOCAL, NOT UTC (finding 15): the ledger/balance/mutation
 * are keyed by calendar YEAR, and a time off starting near midnight UTC can
 * be a different local calendar year for a household away from UTC (a 31
 * Dec 23:00Z start is already 1 Jan locally for anything east of UTC+1).
 * `localDateInZone` — the same household-local-date utility every other
 * money/timesheet surface uses — resolves the year, never `getUTCFullYear`.
 */
import type { CarerTimeOff } from '@steadily-nanny/shared-types/schemas/availability.schema';
import type { MarkTimeOffPaidRequest } from '@steadily-nanny/shared-types/schemas/pto.schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { spacing } from '@/lib/design-tokens';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Body, Small } from '@/src/components/ui/typography';
import {
  type CarerNameSource,
  resolveCarerName,
} from '@/src/domains/schedule/utils/memberDisplayName';
import { useMarkTimeOffPaid } from '@/src/hooks/mutations/useMarkTimeOffPaid';
import { usePtoBalance } from '@/src/hooks/queries/usePtoBalance';
import { usePtoLedger } from '@/src/hooks/queries/usePtoLedger';
import { localDateInZone } from '@/src/lib/localDate';
import { showSuccessToast } from '@/src/lib/toast';
import { netPaidMinutesForTimeOff } from '../utils/ptoNet';
import { formatTimeOffRangeLabel } from '../utils/timeOffDate';
import { MarkTimeOffPaidSheet } from './MarkTimeOffPaidSheet';

interface HouseholdTimeOffRowProps {
  timeOff: CarerTimeOff;
  householdId: string;
  /** Resolved once, by the caller, from `useHouseholdMembers` — undefined
   * for a carer no longer on the ACTIVE roster (removed from the household,
   * `009_households.sql`'s soft `status: 'removed'`, or her account
   * deleted). Her `carer_time_off`/`pto_ledger` rows outlive either case
   * (`carer_time_off` is cascade-deleted only on full account deletion,
   * and `pto_ledger` never is — 043_pto_ledger.sql), so this row still has
   * her booking to show; `resolveCarerName` below falls to the ledger's own
   * `carer_display_name` snapshot rather than the generic role label. */
  member: CarerNameSource | undefined;
  /** The label if even the ledger has nothing to snapshot from (e.g. no PTO
   * has ever been marked paid for her) — the anonymity rule (TIER0-CX-SPEC
   * §5.2) doesn't apply here, this is the household's OWN view of its OWN
   * carer, so a real name is preferred at every step above this. */
  carerFallbackLabel: string;
  /** Parent-editor role gate (defense in depth — the server is the real
   * gate). A non-parent still sees the row and its paid status, just can't
   * open the mark-paid sheet. */
  canMarkPaid: boolean;
  /** IANA timezone — resolves the PTO calendar year against the
   * household's LOCAL date, never UTC (finding 15; see the module doc). */
  householdTimezone: string;
}

export function HouseholdTimeOffRow({
  timeOff,
  householdId,
  member,
  carerFallbackLabel,
  canMarkPaid,
  householdTimezone,
}: HouseholdTimeOffRowProps) {
  const { t } = useTranslation('pay');
  // The sick-kind label is owned by the timeOff namespace (`kind.sick`),
  // reusing the SAME string `TimeOffRow`'s own marker uses on the carer's
  // own cross-household view — one label, not a second one coined here.
  const { t: tTimeOff } = useTranslation('timeOff');
  const [sheetOpen, setSheetOpen] = useState(false);

  const year = Number(
    localDateInZone(householdTimezone, new Date(timeOff.starts_at)).slice(0, 4)
  );
  const ledger = usePtoLedger(householdId, timeOff.user_id, year);
  const balance = usePtoBalance(householdId, timeOff.user_id, year);
  const markPaid = useMarkTimeOffPaid(householdId, timeOff.user_id, year);

  // Active member's live name first, then her PTO ledger's own snapshot
  // (still hers even once she's off the active roster), then the generic
  // fallback if neither has anything.
  const carerName = resolveCarerName(
    member,
    carerFallbackLabel,
    ledger.data?.[0]?.carer_display_name
  );

  const usageEntry =
    (ledger.data ?? []).find(
      entry => entry.kind === 'usage' && entry.time_off_id === timeOff.id
    ) ?? null;
  // Netted against any reversing `adjustment` rows (finding 2) — NOT just
  // "does a usage row exist". `existingUsageEntry` below is still the raw
  // usage row (unrelated concern: it drives the sheet's read-only/"Adjust"
  // flow, which is append-only regardless of the net remainder).
  const netPaidMinutes = netPaidMinutesForTimeOff(
    ledger.data ?? [],
    timeOff.id
  );
  const isPaid = netPaidMinutes > 0;
  const paidHours = netPaidMinutes / 60;

  // D-B1: neither read may be trusted alone — a pending balance with a
  // resolved ledger (or vice versa) is still "we don't know yet".
  const isLoading = ledger.isPending || balance.isPending;
  const isErrored = ledger.isError || balance.isError;
  const canPress = canMarkPaid && !isLoading && !isErrored;

  const rangeLabel = formatTimeOffRangeLabel(
    timeOff.starts_at,
    timeOff.ends_at,
    householdTimezone
  );

  const handlePress = () => {
    if (!canPress) return;
    setSheetOpen(true);
  };

  const handleRetry = () => {
    if (ledger.isError) void ledger.refetch();
    if (balance.isError) void balance.refetch();
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
        accessibilityRole={canPress ? 'button' : undefined}
        disabled={!canPress}
        onPress={handlePress}
      >
        <View
          className="gap-1 rounded-row bg-card px-4 py-3"
          style={{ minHeight: spacing.minTouchTarget }}
        >
          <Body weight="medium">{rangeLabel}</Body>
          {isErrored ? (
            <InlineRetry
              testID={`household-time-off-retry-${timeOff.id}`}
              message={tTimeOff('householdRow.loadError')}
              onRetry={handleRetry}
            />
          ) : isLoading ? null : (
            <StatusPill
              testID={`household-time-off-status-${timeOff.id}`}
              variant={isPaid ? 'confirmed' : 'pending'}
              label={
                isPaid
                  ? t('householdTimeOff.paidBadge', { hours: paidHours })
                  : t('householdTimeOff.notMarkedPaid')
              }
            />
          )}
          {timeOff.kind === 'sick' ? (
            <Small testID={`household-time-off-kind-sick-${timeOff.id}`}>
              {tTimeOff('kind.sick')}
            </Small>
          ) : null}
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
