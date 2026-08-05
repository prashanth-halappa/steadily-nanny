/**
 * @module domains/timesheet/components/ReopenWeekDialog
 *
 * The undo for ApproveWeekDialog — required reason field the API records.
 * Body states plainly that the approved total stops being final and the
 * figure can change.
 *
 * Uses `BottomSheetBase` (same as QueryNoteSheet), not `AlertDialog`: the
 * reason Textarea meets the software keyboard, and AlertDialog has no
 * keyboard avoidance or scroll — on device the keyboard covers confirm and
 * every escape route fails. GOLDEN: never a bare RN Modal (GOLDEN-FIXES #1).
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
 *
 * Caller API stays `open`/`onOpenChange` (ParentWeekView owns the flag);
 * gating (approved week + parent only) stays in the caller.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Small } from '@/src/components/ui/typography';

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
    <BottomSheetBase
      sheetId="hours-reopen"
      visible={open}
      onDismiss={() => handleOpenChange(false)}
      testID="hours-reopen-dialog"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4 testID="hours-reopen-dialog-title">
          {t('reopenDialogTitle', { range: weekRangeLabel })}
        </H4>
        <Body
          testID="hours-reopen-dialog-body"
          className="text-muted-foreground"
        >
          {t('reopenDialogBody')}
        </Body>
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
        <View className="gap-2">
          <Button
            testID="hours-reopen-dialog-cancel"
            variant="outline"
            onPress={() => handleOpenChange(false)}
          >
            <Text>{t('reopenDialogCancel')}</Text>
          </Button>
          <Button
            testID="hours-reopen-dialog-confirm"
            variant="destructive"
            disabled={!canConfirm}
            onPress={handleConfirm}
          >
            <Text>{t('reopenDialogConfirm')}</Text>
          </Button>
        </View>
      </View>
    </BottomSheetBase>
  );
}
