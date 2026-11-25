/**
 * @module domains/schedule/components/PendingAskActions
 *
 * Layout spec §2a: the action row an outstanding one-off cover ask carries
 * on the Agenda (rendered inside its `ShiftRow` via `pendingAskActions`).
 * "Change the ask" re-asks through the extra screen with `replacesShiftId`
 * — the only path that tells the carer (a fresh push and answer-by); the
 * silent `PATCH /shifts/:id` is deliberately not used. "Withdraw the ask"
 * confirms, then `POST /shifts/:id/withdraw-cover-ask`; the gap card comes
 * back on the refetch. Its own component so the withdraw hook only mounts
 * for a row that has an ask to withdraw.
 */
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
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
import { InlineError } from '@/src/components/ui/inline-error';
import { Text } from '@/src/components/ui/text';
import { changeAskHref } from '@/src/domains/schedule/utils/shiftGrouping';
import { useWithdrawCoverAsk } from '@/src/hooks/mutations/useWithdrawCoverAsk';
import { getLocalizedErrorMessage } from '@/src/lib/errorLocalization';

export function PendingAskActions({
  shift,
  carerName,
  closedReason,
}: {
  shift: Shift;
  /** First name for the confirm copy; '' falls back inside the copy. */
  carerName: string;
  closedReason: string | null;
}) {
  const { t } = useTranslation('schedule');
  const { t: tErrors } = useTranslation('errors');
  const router = useRouter();
  const withdraw = useWithdrawCoverAsk();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testID = `schedule-shift-withdraw-ask-${shift.id}`;

  const close = () => {
    setOpen(false);
    setError(null);
  };

  return (
    <View
      testID={`schedule-shift-ask-actions-${shift.id}`}
      className="flex-row gap-2"
    >
      <View className="flex-1">
        <RestrictedActionButton
          testID={`schedule-shift-change-ask-${shift.id}`}
          size="sm"
          variant="ghost"
          label={t('cover.changeAsk')}
          reason={closedReason}
          onPress={() => router.push(changeAskHref(shift) as Href)}
        />
      </View>
      <View className="flex-1">
        <RestrictedActionButton
          testID={testID}
          size="sm"
          variant="ghost"
          label={t('cover.withdrawAsk')}
          reason={closedReason}
          disabled={withdraw.isPending}
          onPress={() => {
            setError(null);
            setOpen(true);
          }}
        />
      </View>
      <AlertDialog
        open={open}
        onOpenChange={next => {
          if (!next) close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('cover.withdrawAskConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('cover.withdrawAskConfirmBody', { carerName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <InlineError testID={`${testID}-error`} message={error} />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel testID={`${testID}-keep`} onPress={close}>
              <Text>{t('cover.withdrawAskConfirmKeep')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              testID={`${testID}-confirm`}
              disabled={withdraw.isPending}
              onPress={() => {
                setError(null);
                void withdraw
                  .mutateAsync(shift.id)
                  .then(close)
                  .catch(err => {
                    setError(getLocalizedErrorMessage(err, tErrors));
                  });
              }}
            >
              <Text>{t('cover.withdrawAskConfirmWithdraw')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
