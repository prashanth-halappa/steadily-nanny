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
 * distinction). `grossLabel: null` renders the no-arrangement body variant
 * (§4.3: a week can be approved with no pay rate set at all — hours still
 * lock, there is simply nothing to total).
 */
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
  /** `null` -> no arrangement: the body drops the gross clause entirely
   * (§4.3's no-arrangement variant), never a £0.00 stand-in. */
  grossLabel: string | null;
  carerName: string;
}

export function ApproveWeekDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  weekRangeLabel,
  hoursLabel,
  grossLabel,
  carerName,
}: ApproveWeekDialogProps) {
  const { t } = useTranslation('hours');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID="hours-approve-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle testID="hours-approve-dialog-title">
            {t('approveDialogTitle', { range: weekRangeLabel })}
          </AlertDialogTitle>
          <AlertDialogDescription testID="hours-approve-dialog-body">
            {grossLabel === null
              ? t('approveDialogBodyNoArrangement', {
                  hours: hoursLabel,
                  name: carerName,
                })
              : t('approveDialogBody', {
                  hours: hoursLabel,
                  gross: grossLabel,
                  name: carerName,
                })}
          </AlertDialogDescription>
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
