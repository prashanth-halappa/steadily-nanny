/**
 * @module domains/timesheet/components/ReopenWeekDialog
 *
 * The undo for ApproveWeekDialog — same controlled AlertDialog pattern
 * (`open`/`onOpenChange` owned by the caller), same testID naming shape,
 * plus a required reason field the API records. Body states plainly that
 * the approved total stops being final and the figure can change.
 *
 * Walkthrough fix 3: the reason is compelled but, before this, nothing told
 * the parent where it goes — and `apps/mobile/src` has no surface that
 * reads it back (it lands on a `shift_events` row with `shift_id: null`;
 * see `timesheetCommandService.reopen`'s doc comment). `reopenDialogReasonHint`
 * says the true, honest thing — it stays on the household's record — and
 * doubles as the "this field is required" cue, since the confirm button's
 * own disabled→enabled transition is too subtle to notice on its own.
 *
 * The confirm action gets the same `destructive` treatment as this app's
 * other real destructive confirms (`settings-delete-account-confirm`,
 * `ScheduleRespondScreen`'s decline confirm) — reopening un-approves a
 * week of pay, and looking like an ordinary primary button undersells that.
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
import { buttonVariants } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Small } from '@/src/components/ui/typography';

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
        <Small
          testID="hours-reopen-dialog-reason-hint"
          className="text-muted-foreground"
        >
          {t('reopenDialogReasonHint')}
        </Small>
        <AlertDialogFooter>
          <AlertDialogCancel testID="hours-reopen-dialog-cancel">
            <Text>{t('reopenDialogCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="hours-reopen-dialog-confirm"
            className={buttonVariants({ variant: 'destructive' })}
            disabled={!canConfirm}
            onPress={handleConfirm}
          >
            <Text className="text-destructive-foreground">
              {t('reopenDialogConfirm')}
            </Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
