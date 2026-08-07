/**
 * @module domains/timeOff/components/SickTimeOffButton
 *
 * "I'm sick today" quick action (068) on the carer's own Time off screen —
 * NOT the Today screen (owned by another wave slice; a Today-screen entry
 * point is a documented follow-up, see this module's own header note and
 * the wave report). Confirms via `AlertDialog` (never a bare RN `Modal`,
 * GOLDEN-FIX #1) with copy that states plainly the family will be notified,
 * then creates a SAME-DAY, `all_day`, `kind: 'sick'` time-off request —
 * same-day sick creation is explicitly allowed server-side (unlike a
 * forward-dated personal request, which nothing here restricts either).
 *
 * The server sends parents a "called in sick" push automatically when a
 * confirmed shift overlaps — this component does nothing beyond creating
 * the row with `kind: 'sick'`; all notification logic is server-side.
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
  AlertDialogTrigger,
} from '@/src/components/ui/alert-dialog';
import { buttonVariants } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { useRequestTimeOff } from '@/src/hooks/mutations/useRequestTimeOff';
import { showSuccessToast } from '@/src/lib/toast';
import { toAllDayRange, todayISO } from '../utils/timeOffDate';

export function SickTimeOffButton() {
  const { t } = useTranslation('timeOff');
  const requestTimeOff = useRequestTimeOff();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async () => {
    setConfirmOpen(false);
    const today = todayISO();
    const { starts_at, ends_at } = toAllDayRange(today, today);
    try {
      await requestTimeOff.mutateAsync({
        starts_at,
        ends_at,
        all_day: true,
        kind: 'sick',
      });
    } catch {
      // onError on the mutation already surfaced a toast.
      return;
    }
    showSuccessToast(t('sickToast'));
  };

  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogTrigger
        testID="time-off-sick-today"
        className={buttonVariants({ variant: 'outline' })}
        disabled={requestTimeOff.isPending}
      >
        <Text>{t('sickButton')}</Text>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('sickConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('sickConfirmBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel testID="time-off-sick-cancel">
            <Text>{t('sickConfirmCancel')}</Text>
          </AlertDialogCancel>
          <AlertDialogAction
            testID="time-off-sick-confirm"
            disabled={requestTimeOff.isPending}
            onPress={() => void handleConfirm()}
          >
            <Text className="text-primary-foreground font-medium">
              {t('sickConfirmConfirm')}
            </Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
