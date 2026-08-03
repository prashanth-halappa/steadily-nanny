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
 * Daylight audit P0-2 — the sheet used to ask for a break without ever
 * showing the clock-in time, the clock-out time, or the resulting total, so
 * tapping "30 min" silently changed the recorded day with no on-screen
 * acknowledgement. The summary block below the break picker fixes that: it
 * recomputes live off `breakMinutes` (and `nowMs`, injectable for tests)
 * with `computeWorkedMinutesFromInstants` — the SAME rule the server uses
 * in `computeWorkedMinutes` (see that function's own comment for why the
 * two formulas are equivalent) — so the number shown is the number that
 * will be recorded. A break longer than the elapsed time clamps the preview
 * to 0m, same as the server: it must read as "no hours", not as an error
 * the nanny has to resolve before she can leave.
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
// Direct file imports, NOT the domain barrel (`@/src/domains/timesheet`) —
// that barrel re-exports `HoursScreen`, which pulls in `LoadingIndicator`'s
// `require('@/assets/splash.png')` and breaks bundling under bun:test (see
// HoursScreen.test.tsx's header comment). These utils are pure and have no
// such cost, so importing them directly avoids forcing every test that
// renders this sheet to mock loading-indicator for an unrelated import.
import {
  formatClockTime,
  formatDuration,
} from '@/src/domains/timesheet/utils/duration';
import { computeWorkedMinutesFromInstants } from '@/src/domains/timesheet/utils/entryMinutes';

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
  /** ISO clock-in instant for the live summary preview. `null` only for the
   * data-anomaly case of a running entry with no recorded clock-in — the
   * summary is simply omitted then, same defensive pattern as `ClockInCard`'s
   * own `entry.clock_in_at ?` guard. */
  clockInAt: string | null;
  /** Household IANA zone — every time label here is zone-aware, never the
   * device's (GOLDEN-FIXES #21 bug class; see
   * domains/timesheet/utils/week.ts's header). */
  timeZone: string;
  /** "Now", for the live "Out"/total preview. Defaults to the real current
   * time; tests inject a fixed value for determinism. Re-evaluated on every
   * render, so it moves as the break selection changes. */
  nowMs?: number;
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
  clockInAt,
  timeZone,
  nowMs = Date.now(),
}: ClockOutSheetProps) {
  const { t } = useTranslation('today');
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [breakMinutesText, setBreakMinutesText] = useState('0');
  const [note, setNote] = useState('');

  const workedMinutes = clockInAt
    ? computeWorkedMinutesFromInstants(clockInAt, nowMs, breakMinutes)
    : 0;

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
                // Daylight audit #39 — the small button size is 36px tall,
                // under the 44pt minimum touch target, and these are tapped
                // one-handed at the door. The default size (native:h-12)
                // clears it.
                size="default"
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
          <View className="gap-1">
            <Small className="text-muted-foreground">
              {t('customBreakLabel')}
            </Small>
            <View className="flex-row items-center gap-2">
              <Input
                testID="clockout-break-custom"
                accessibilityLabel={t('customBreakLabel')}
                value={breakMinutesText}
                onChangeText={handleBreakMinutesChange}
                keyboardType="number-pad"
                className="w-20"
              />
              <Small className="text-muted-foreground">
                {t('minutesUnit')}
              </Small>
            </View>
          </View>
        </View>

        {clockInAt ? (
          <View
            testID="clockout-summary"
            className="flex-row flex-wrap items-baseline gap-x-1"
          >
            <Small
              testID="clockout-summary-prefix"
              className="text-muted-foreground"
              tabular
            >
              {t('clockOutSummaryPrefix', {
                in: formatClockTime(clockInAt, timeZone),
                out: formatClockTime(new Date(nowMs).toISOString(), timeZone),
                breakMinutes,
              })}
            </Small>
            <Body
              testID="clockout-summary-total"
              className="font-semibold"
              tabular
            >
              {formatDuration(workedMinutes)}
            </Body>
          </View>
        ) : null}

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
