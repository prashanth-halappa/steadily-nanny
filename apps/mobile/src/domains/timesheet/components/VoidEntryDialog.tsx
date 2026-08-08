/**
 * @module domains/timesheet/components/VoidEntryDialog
 *
 * The confirm step in front of voiding a time entry (069). Voiding is a soft
 * delete — the row stays visible, struck through — but it removes hours from
 * a pay record, so it gets the same deliberate confirmation an approval does
 * rather than a one-tap destructive action inside the edit sheet.
 *
 * Copy says plainly what survives ("stays visible here") and what does not
 * ("won't count toward your hours or pay"), because a carer who thinks this
 * erases the record would not use it, and one who thinks it is reversible
 * would use it too freely.
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

interface VoidEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  /**
   * Copy overrides for the RUNNING-entry path, which speaks a different
   * register: the trigger is in her voice ("I didn't mean to clock in") and
   * discarding a live clock-in removes nothing that was ever banked, so the
   * finished-entry wording ("won't count toward your hours or pay") would
   * overstate it. Defaults keep the Hours caller untouched.
   */
  title?: string;
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  /** Lets the two callers own distinct testIDs without a duplicate component. */
  testIDPrefix?: string;
}

export function VoidEntryDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  title,
  body,
  cancelLabel,
  confirmLabel,
  testIDPrefix = 'hours-void-dialog',
}: VoidEntryDialogProps) {
  const { t } = useTranslation('hours');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID={testIDPrefix}>
        <AlertDialogHeader>
          <AlertDialogTitle testID={`${testIDPrefix}-title`}>
            {title ?? t('voidConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription testID={`${testIDPrefix}-body`}>
            {body ?? t('voidConfirmBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel testID={`${testIDPrefix}-cancel`}>
            <Text>{cancelLabel ?? t('voidConfirmCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID={`${testIDPrefix}-confirm`}
            disabled={isSubmitting}
            onPress={onConfirm}
          >
            <Text>{confirmLabel ?? t('voidConfirmAction')}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
