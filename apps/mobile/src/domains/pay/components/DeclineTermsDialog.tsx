/**
 * @module domains/pay/components/DeclineTermsDialog
 *
 * B4's confirm step — refusing terms is not an accidental tap. Same shape as
 * `WithdrawQueryDialog`/`VoidEntryDialog`: an `AlertDialog`, not
 * `BottomSheetBase`, because there is no text input to meet the software
 * keyboard.
 *
 * Not `destructive`-styled: declining takes nothing away and costs the OTHER
 * side nothing they had — it ends a negotiation, the same non-alarming
 * register `WithdrawQueryDialog` uses for its own "takes a question back".
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

interface DeclineTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}

export function DeclineTermsDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: DeclineTermsDialogProps) {
  const { t } = useTranslation('pay');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID="proposal-decline-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle testID="proposal-decline-dialog-title">
            {t('proposal.decline.title')}
          </AlertDialogTitle>
          <AlertDialogDescription testID="proposal-decline-dialog-body">
            {t('proposal.decline.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel testID="proposal-decline-dialog-cancel">
            <Text>{t('proposal.decline.cancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="proposal-decline-dialog-confirm"
            disabled={isSubmitting}
            onPress={onConfirm}
          >
            <Text>{t('proposal.decline.confirm')}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
