/**
 * @module domains/timeOff/components/MarkTimeOffPaidSheet
 *
 * TIER0-CX-SPEC.md §5.1 — "Mark this time off paid" on the household's
 * time-off surface. `BottomSheetBase`, never a bare RN `<Modal>`
 * (GOLDEN-FIXES #1).
 *
 * Sheet-owns-values, screen-owns-mutation (the `ClockOutSheet`/`PayChangeSheet`
 * discipline): this component only builds and reports a
 * `MarkTimeOffPaidRequest` via `onSubmit`; the caller decides whether to
 * close the sheet, and only does so on success — a mutation failure leaves
 * the typed hours/note intact so the parent doesn't have to retype them.
 *
 * WARN, NEVER BLOCK on over-balance (TIER0-PLAN.md Phase 3, review finding
 * 16): a household may mark more time paid than a carer has accrued. The
 * after-figure renders `text-warning-strong` and an explanatory line
 * appears, but the submit button is NEVER disabled for this reason — only
 * an empty/non-positive hours field disables it.
 *
 * SIMPLIFICATION (documented, not silent, same posture as `PayChangeSheet`'s
 * own header comment): the spec calls for the hours field to pre-fill with
 * "the computed working overlap" for the time-off span. That computation
 * needs the carer's scheduled shifts for that week, which this sheet has no
 * hook to reach (schedule-pattern integration is a separate workstream).
 * The field opens BLANK instead — inventing a number here would violate the
 * app's own "never show a figure you cannot back with data" discipline more
 * than an unfilled field does — and the hint text is left in place, since it
 * remains correct once that integration lands.
 *
 * ALREADY-MARKED / APPEND-ONLY (spec): when a usage ledger row already
 * exists for this time off, the sheet opens READ-ONLY with the paid summary
 * and a ghost "Adjust" button. Tapping it reveals the same editable form —
 * a correction is submitted through the identical `onSubmit` call, which the
 * server appends as a new `adjustment` row rather than mutating the
 * existing `usage` row (the ledger is append-only end to end; there is no
 * edit-in-place path anywhere in this stack).
 */
import type {
  MarkTimeOffPaidRequest,
  PtoBalance,
  PtoLedgerEntry,
} from '@steadily-nanny/shared-types/schemas/pto.schema';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Label, Small } from '@/src/components/ui/typography';
import { formatDisplayDate } from '@/src/domains/timesheet/utils/week';
import { formatSignedHours } from '../../pay/utils/ptoFormat';

export interface MarkTimeOffPaidSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (input: MarkTimeOffPaidRequest) => void;
  isSubmitting: boolean;
  /** The carer whose time off this is — never rendered anywhere OTHER than
   * this household-scoped sheet (this is the household's OWN nanny; the
   * anonymity rule is only for the nanny's cross-family surface, §5.2). */
  carerName: string;
  /** Pre-formatted date range, e.g. "Mon 24 – Wed 26 August". */
  rangeLabel: string;
  timeOffId: string;
  /** `undefined` while the balance query is loading, `null` when there is
   * nothing to compute against (no entitlement) — the before/after block is
   * simply omitted in both cases; marking paid is still allowed. */
  balance: PtoBalance | null | undefined;
  /** The existing `usage` ledger row for this time off, if any — presence
   * means "already marked paid", which opens the sheet read-only. */
  existingUsageEntry: PtoLedgerEntry | null;
}

/** Plain decimal hours: `8`, `7.5`, `0.25`. No sign, no scientific notation,
 * no grouping — the same whole-string-match discipline `src/lib/money.ts`'s
 * `parseMajorToMinor` uses, applied to hours instead of money (Phase 3+4
 * adversarial review, finding 13). Bare `Number()` accepted `"2e1"` as `20`
 * (scientific notation nobody typed on purpose) and let `0.004` — a real,
 * non-zero-looking input — round to `0` minutes and submit anyway,
 * guaranteeing the server's `.min(1)` check rejects it with a 400 the
 * parent gets to interpret with no context. */
const HOURS_PATTERN = /^\d+(?:\.\d+)?$/;

function parseHoursToMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || !HOURS_PATTERN.test(trimmed)) return null;

  const hours = Number(trimmed);
  if (!Number.isFinite(hours) || hours < 0) return null;

  const minutes = Math.round(hours * 60);
  // Exactly 0 is VALID and meaningful: the server reads a total of 0 as
  // "reverse this marking entirely", which is the only way to un-pay a time
  // off that was marked by mistake. Without this the two halves of the
  // Phase 3/4 review fixes contradict each other — the API gained the
  // reversal semantics while the client refused to express them.
  if (hours === 0) return 0;

  // A POSITIVE number of hours that still rounds to 0 minutes (e.g. 0.004h)
  // is different: it is real input the server would reject as 0, and
  // silently treating it as a full reversal would un-pay her by accident.
  // Refuse it with a message instead.
  return minutes > 0 ? minutes : null;
}

export function MarkTimeOffPaidSheet({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  carerName,
  rangeLabel,
  timeOffId,
  balance,
  existingUsageEntry,
}: MarkTimeOffPaidSheetProps) {
  const { t } = useTranslation('pay');
  const [hoursText, setHoursText] = useState('');
  const [note, setNote] = useState('');
  // Starts editable only when there is nothing to show read-only.
  const [adjusting, setAdjusting] = useState(existingUsageEntry === null);

  // Re-seed every time the sheet opens — it stays mounted between openings
  // (the `ClockOutSheet` pattern), so without this a later time-off row
  // would show the previous row's typed values.
  useEffect(() => {
    if (!visible) return;
    setHoursText('');
    setNote('');
    setAdjusting(existingUsageEntry === null);
  }, [visible, existingUsageEntry]);

  const enteredMinutes = parseHoursToMinutes(hoursText);
  const hoursInvalid = hoursText.trim() !== '' && enteredMinutes === null;
  const beforeMinutes = balance?.balance_minutes ?? null;
  const afterMinutes =
    beforeMinutes !== null && enteredMinutes !== null
      ? beforeMinutes - enteredMinutes
      : null;
  const isOverBalance = afterMinutes !== null && afterMinutes < 0;

  const handleSubmit = () => {
    if (enteredMinutes === null) return;
    const trimmedNote = note.trim();
    onSubmit({
      time_off_id: timeOffId,
      minutes: enteredMinutes,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });
  };

  const showReadOnly = existingUsageEntry !== null && !adjusting;

  return (
    <BottomSheetBase
      sheetId="pto-mark-paid"
      visible={visible}
      onDismiss={onDismiss}
      testID="pto-mark-paid-sheet"
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('markPaidSheet.title')}</H4>
        <Body className="text-muted-foreground">
          {t('markPaidSheet.subtitle', { name: carerName, range: rangeLabel })}
        </Body>

        {showReadOnly && existingUsageEntry ? (
          <>
            <Body testID="pto-mark-paid-already-paid">
              {t('markPaidSheet.alreadyPaid', {
                date: formatDisplayDate(existingUsageEntry.effective_date),
                hours: Math.abs(existingUsageEntry.minutes) / 60,
              })}
            </Body>
            <Button
              testID="pto-mark-paid-adjust"
              variant="ghost"
              onPress={() => setAdjusting(true)}
            >
              <Text>{t('markPaidSheet.adjustButton')}</Text>
            </Button>
            <Small className="text-muted-foreground">
              {t('markPaidSheet.adjustHint')}
            </Small>
          </>
        ) : (
          <>
            <View className="gap-2">
              <Label>{t('markPaidSheet.hoursLabel')}</Label>
              <Input
                testID="pto-mark-paid-hours-input"
                accessibilityLabel={t('markPaidSheet.hoursLabel')}
                value={hoursText}
                onChangeText={setHoursText}
                keyboardType="decimal-pad"
                error={hoursInvalid}
              />
              {hoursInvalid ? (
                <Small
                  testID="pto-mark-paid-hours-error"
                  className="text-error-inline-text"
                >
                  {t('markPaidSheet.hoursError')}
                </Small>
              ) : (
                <Small className="text-muted-foreground">
                  {t('markPaidSheet.hoursHint')}
                </Small>
              )}
            </View>

            {beforeMinutes !== null ? (
              <View
                testID="pto-mark-paid-before-after"
                className="rounded-cell bg-muted px-4 py-3"
              >
                <Body tabular>
                  {t('markPaidSheet.balanceBeforeAfter', {
                    before: formatSignedHours(beforeMinutes),
                    after: formatSignedHours(afterMinutes ?? beforeMinutes),
                  })}
                </Body>
              </View>
            ) : null}

            {isOverBalance ? (
              <Small
                testID="pto-mark-paid-over-balance-warning"
                className="text-warning-ink"
              >
                {t('markPaidSheet.overBalanceWarning', {
                  after: formatSignedHours(afterMinutes ?? 0),
                })}
              </Small>
            ) : null}

            <View className="gap-2">
              <Label>{t('markPaidSheet.noteLabel')}</Label>
              <Textarea
                testID="pto-mark-paid-note-input"
                accessibilityLabel={t('markPaidSheet.noteLabel')}
                value={note}
                onChangeText={setNote}
              />
            </View>

            <LoadingButton
              testID="pto-mark-paid-submit"
              label={t('markPaidSheet.confirmButton')}
              isLoading={isSubmitting}
              disabled={enteredMinutes === null}
              onPress={handleSubmit}
            />
          </>
        )}
      </View>
    </BottomSheetBase>
  );
}
