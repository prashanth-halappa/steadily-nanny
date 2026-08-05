/**
 * @module domains/timesheet/components/ReopenWeekDialog
 *
 * The undo for ApproveWeekDialog — same controlled AlertDialog pattern
 * (`open`/`onOpenChange` owned by the caller), same testID naming shape,
 * plus a required reason field the API records. Body states plainly that
 * the approved total stops being final and the figure can change.
 */
import { useState } from 'react';
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
import { Textarea } from '@/src/components/ui/textarea';

interface ReopenWeekDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isSubmitting: boolean;
  weekRangeLabel: string;
}

export function ReopenWeekDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  weekRangeLabel,
}: ReopenWeekDialogProps) {
  const { t } = useTranslation('hours');
  const [reason, setReason] = useState('');

  const trimmed = reason.trim();
  const canConfirm = trimmed.length > 0 && !isSubmitting;

  const handleOpenChange = (next: boolean) => {
    if (!next) setReason('');
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
    setReason('');
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent testID="hours-reopen-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle testID="hours-reopen-dialog-title">
            {t('reopenDialogTitle', { range: weekRangeLabel })}
          </AlertDialogTitle>
          <AlertDialogDescription testID="hours-reopen-dialog-body">
            {t('reopenDialogBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          testID="hours-reopen-dialog-reason"
          accessibilityLabel={t('reopenDialogReasonPlaceholder')}
          value={reason}
          onChangeText={setReason}
          placeholder={t('reopenDialogReasonPlaceholder')}
        />
        <AlertDialogFooter>
          <AlertDialogCancel testID="hours-reopen-dialog-cancel">
            <Text>{t('reopenDialogCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="hours-reopen-dialog-confirm"
            disabled={!canConfirm}
            onPress={handleConfirm}
          >
            <Text>{t('reopenDialogConfirm')}</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
