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
}

export function VoidEntryDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: VoidEntryDialogProps) {
  const { t } = useTranslation('hours');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID="hours-void-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle testID="hours-void-dialog-title">
            {t('voidConfirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription testID="hours-void-dialog-body">
            {t('voidConfirmBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel testID="hours-void-dialog-cancel">
            <Text>{t('voidConfirmCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="hours-void-dialog-confirm"
            disabled={isSubmitting}
            onPress={onConfirm}
          >
            <Text>{t('voidConfirmAction')}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
