/**
 * @module domains/timesheet/components/ApproveWeekDialog
 *
 * TIER0-CX-SPEC.md §4.3 — replaces the old one-tap "Approve the week" button
 * with a confirmation: approving freezes both the hours AND the gross figure
 * (the earnings snapshot), so the parent sees exactly what she is locking in
 * before she locks it in. `AlertDialog`, not a bare `<Modal>` — the same
 * `ManageHouseholdScreen.tsx` "controlled, no Trigger" pattern: this
 * component owns no state of its own, `open`/`onOpenChange` are the caller's.
 *
 * The gross figure is echoed as TEXT inside the body sentence, tabular but
 * NOT a hero number — this is a confirmation, not a receipt (spec's own
 * distinction). The body variant follows `earningsStatus`: `ok` shows the
 * gross clause; `currency_change` explains the mid-week currency switch;
 * everything else (`no_arrangement`, missing earnings) drops the gross.
 *
 * D-5 / §11.1.1's fast path: the plain `ok`, no-adjustment body swaps in
 * "Nothing unusual this week" when the server's `nothing_unusual` judgement
 * says so — never claimed alongside a staged adjustment (decided THIS
 * approval, after that server read) or on any non-`ok` status.
 */
import type { WeekEarningsState } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { useTranslation } from 'react-i18next';
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
import { Text } from '@/src/components/ui/text';
import { Small } from '@/src/components/ui/typography';

interface ApproveWeekDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  weekRangeLabel: string;
  /** "41h 00m" style — `formatEarningsDuration`'s ledger format, not the
   * headline `formatDuration` (matches the breakdown sheet's row style, and
   * the spec's own worked example). */
  hoursLabel: string;
  /** Formatted gross — only rendered when `earningsStatus === 'ok'`. Already
   * ADJUSTED by the caller when an adjustment is staged: the figure being
   * confirmed is the figure that gets frozen, never the pre-adjustment one. */
  grossLabel: string | null;
  /** Drives which body variant renders — not inferred from `grossLabel`. */
  earningsStatus?: WeekEarningsState;
  carerName: string;
  /** The staged adjustment's ABSOLUTE formatted value, or null. The verb in
   * the body copy ("adding" / "taking off") carries the sign, so a minus
   * sign here would say it twice. */
  adjustmentLabel: string | null;
  /** Which way `adjustmentLabel` points — the sign, extracted, because the
   * label itself is deliberately unsigned. */
  adjustmentDirection?: 'added' | 'deducted' | null;
  /** D-5 / §11.1.1's fast path, straight off the week response
   * (`timesheet.nothing_unusual`). Only ever swaps in the plain `ok` body —
   * a staged adjustment (decided THIS approval, after the server's read)
   * always wins, and every non-`ok` status keeps its own body untouched. */
  nothingUnusual?: boolean | null;
  /** `earningsStructureLine(earnings)` — rendered under the body on `ok`
   * weeks only, so the parent sees the hour arithmetic before locking in. */
  structureLine?: string | null;
}

export function ApproveWeekDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  weekRangeLabel,
  hoursLabel,
  grossLabel,
  earningsStatus,
  carerName,
  adjustmentLabel,
  adjustmentDirection,
  nothingUnusual = null,
  structureLine = null,
}: ApproveWeekDialogProps) {
  const { t } = useTranslation('hours');

  const hasAdjustment = adjustmentLabel !== null && adjustmentDirection != null;
  const okBodyKey =
    hasAdjustment && adjustmentDirection === 'deducted'
      ? 'approveDialogBodyAdjustmentDeducted'
      : hasAdjustment
        ? 'approveDialogBodyAdjustmentAdded'
        : nothingUnusual
          ? 'approveDialogBodyNothingUnusual'
          : 'approveDialogBody';
  const bodyKey =
    earningsStatus === 'ok'
      ? okBodyKey
      : earningsStatus === 'currency_change'
        ? 'approveDialogBodyCurrencyChange'
        : 'approveDialogBodyNoArrangement';
  const showsGross = earningsStatus === 'ok';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID="hours-approve-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle testID="hours-approve-dialog-title">
            {t('approveDialogTitle', { range: weekRangeLabel })}
          </AlertDialogTitle>
          <AlertDialogDescription testID="hours-approve-dialog-body">
            {t(bodyKey, {
              hours: hoursLabel,
              ...(showsGross ? { gross: grossLabel } : {}),
              ...(showsGross && hasAdjustment
                ? { adjustment: adjustmentLabel }
                : {}),
              name: carerName,
            })}
          </AlertDialogDescription>
          {showsGross && structureLine ? (
            <Small
              testID="hours-approve-dialog-structure"
              className="text-muted-foreground"
            >
              {structureLine}
            </Small>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel testID="hours-approve-dialog-cancel">
            <Text>{t('approveDialogCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="hours-approve-dialog-confirm"
            disabled={isSubmitting}
            onPress={onConfirm}
          >
            <Text>{t('approveDialogConfirm')}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
