/**
 * @module domains/timesheet/components/WithdrawQueryDialog
 *
 * The parent's exit from `queried` (D-19,
 * `docs/design/attention-and-notifications.md` §3). Confirms, and states the
 * two things the parent needs to know: the week goes back to waiting on
 * them, and nothing already said is erased.
 *
 * An `AlertDialog`, NOT a `BottomSheetBase` — the opposite call from
 * `ReopenWeekDialog`, and for its own stated reason. That dialog is a sheet
 * only because its required-reason `Textarea` has to meet the software
 * keyboard, which `AlertDialog` cannot avoid. There is no text input here
 * (withdrawing is not re-litigating the record — the thread already holds
 * what was said), so the `ApproveWeekDialog` shape is the right one.
 *
 * The confirm is NOT `destructive`. Withdrawing takes a question back; it
 * un-approves nothing, deletes nothing, and costs the carer nothing — the
 * red treatment `ReopenWeekDialog` earns would be borrowing alarm it hasn't.
 *
 * Caller API stays `open`/`onOpenChange` (ParentWeekView owns the flag);
 * gating (queried week + parent only) stays in the caller.
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

interface WithdrawQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}

export function WithdrawQueryDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: WithdrawQueryDialogProps) {
  const { t } = useTranslation('hours');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID="hours-withdraw-query-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle testID="hours-withdraw-query-dialog-title">
            {t('withdrawQueryDialogTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription testID="hours-withdraw-query-dialog-body">
            {t('withdrawQueryDialogBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel testID="hours-withdraw-query-dialog-cancel">
            <Text>{t('withdrawQueryDialogCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="hours-withdraw-query-dialog-confirm"
            disabled={isSubmitting}
            onPress={onConfirm}
          >
            <Text>{t('withdrawQueryDialogConfirm')}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
