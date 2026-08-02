/**
 * @module domains/today/components/ClockOutSheet
 *
 * D20 — `ClockInCard`'s clock-out call site sent no input at all, so
 * `break_minutes` was permanently 0 and `note` permanently null while the
 * server's `computeWorkedMinutes` faithfully subtracted a break it never
 * received. Every day with a genuine unpaid break was recorded as more
 * hours worked than actually happened. This sheet is the fix: it lets the
 * nanny enter a break and an optional note before confirming clock-out.
 *
 * Stays fast for the common case — most days have no break, and a nanny
 * clocking out at the door shouldn't face a form. The break picker starts
 * on "No break" already selected, so confirming immediately (no interaction
 * at all) submits `{ breakMinutes: 0, note: '' }`; adding a break is one tap
 * on a quick-pick chip, or a typed custom value for anything else.
 *
 * GOLDEN: uses `BottomSheetBase`, never a bare RN Modal directly
 * (GOLDEN-FIXES #1 — iOS modal-freeze).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Small } from '@/src/components/ui/typography';

const QUICK_BREAK_MINUTES = [0, 15, 30, 45, 60] as const;

export interface ClockOutSheetSubmitInput {
  breakMinutes: number;
  note: string;
}

interface ClockOutSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: ClockOutSheetSubmitInput) => void;
  isSubmitting: boolean;
}

/** Parses a break-minutes text field to a non-negative integer, defaulting
 * to 0 for anything invalid rather than letting NaN reach the server. */
function parseBreakMinutes(text: string): number {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function ClockOutSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
}: ClockOutSheetProps) {
  const { t } = useTranslation('today');
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [breakMinutesText, setBreakMinutesText] = useState('0');
  const [note, setNote] = useState('');

  const selectQuickBreak = (minutes: number) => {
    setBreakMinutes(minutes);
    setBreakMinutesText(String(minutes));
  };

  const handleBreakMinutesChange = (text: string) => {
    setBreakMinutesText(text);
    setBreakMinutes(parseBreakMinutes(text));
  };

  const handleSubmit = () => {
    onSubmit({ breakMinutes, note: note.trim() });
    setBreakMinutes(0);
    setBreakMinutesText('0');
    setNote('');
  };

  return (
    <BottomSheetBase
      sheetId="today-clock-out"
      visible={visible}
      onDismiss={onDismiss}
      testID="clockout-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('clockOutSheetTitle')}</H4>
        <Body className="text-muted-foreground">{t('clockOutSheetHint')}</Body>

        <View className="gap-2">
          <Small className="text-muted-foreground">{t('breakLabel')}</Small>
          <View
            className="flex-row flex-wrap gap-2"
            testID="clockout-break-options"
          >
            {QUICK_BREAK_MINUTES.map(minutes => (
              <Button
                key={minutes}
                testID={`clockout-break-${minutes}`}
                variant={breakMinutes === minutes ? 'default' : 'outline'}
                size="sm"
                onPress={() => selectQuickBreak(minutes)}
              >
                <Text>
                  {minutes === 0
                    ? t('noBreak')
                    : t('breakMinutesOption', { minutes })}
                </Text>
              </Button>
            ))}
          </View>
          <Input
            testID="clockout-break-custom"
            accessibilityLabel={t('breakLabel')}
            value={breakMinutesText}
            onChangeText={handleBreakMinutesChange}
            keyboardType="number-pad"
          />
        </View>

        <Textarea
          testID="clockout-note"
          accessibilityLabel={t('noteLabel')}
          value={note}
          onChangeText={setNote}
          placeholder={t('notePlaceholder')}
        />

        <LoadingButton
          testID="clockout-confirm"
          label={t('clockOut')}
          isLoading={isSubmitting}
          onPress={handleSubmit}
        />
      </View>
    </BottomSheetBase>
  );
}
