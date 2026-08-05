/**
 * @module domains/expenses/components/ExpenseReviewSheet
 *
 * The parent's pending-expenses review (TIER0-CX-SPEC.md §6.2):
 * `BottomSheetBase`, `sheetId="expense-review"`. One card per pending item
 * — date, description, and amount OR miles — with "Approve" (default) and
 * "Not this one" (`variant="ghost"`, `text-destructive`), the latter
 * revealing an optional note before "Send".
 *
 * OWNER RULING (binding, overrides the spec's own worked example of
 * "12.4 miles → £5.58"): pending mileage shows MILES ONLY, never an
 * indicative amount — the amount is computed and frozen server-side at
 * approval. `amount_minor` is `null` on every pending mileage row by DB
 * constraint (migration 044's third CHECK: "no indicative amount before
 * approval"), so this component only ever HAS a real amount to show for a
 * pending `expense`-kind row.
 *
 * Screen-owns-mutation (the house discipline): this sheet only reports
 * `onApprove`/`onReject`; the caller (`ParentWeekView`) wires
 * `useReviewExpense`, tracks which row is submitting, and — for the
 * no-mileage-rate typed error — which row to show the inline "Set a
 * mileage rate before approving mileage." arm on.
 *
 * GENERIC TYPED-ERROR ARM (Phase 3+4 adversarial review, finding 6):
 * `genericErrorId` covers every OTHER deliberate, server-coded refusal —
 * concretely, reviewing an expense into a week that's already `approved`.
 * The API side is still deciding whether that lands as a typed error or a
 * silent week-reopen (see `ParentWeekView`'s TODO for the exact code this
 * will branch on once known); until then, ANY typed 4xx refusal that isn't
 * the recognised `NO_MILEAGE_RATE` arm surfaces here instead of leaving the
 * parent with only the ambient generic toast, which names neither the
 * claim nor the reason.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Textarea } from '@/src/components/ui/textarea';
import { Body, H4, Small } from '@/src/components/ui/typography';
import { formatEarningsSpanDate } from '@/src/domains/timesheet/utils/earningsFormat';
import { formatMoney } from '@/src/lib/money';
import type { Expense } from '../types';

interface ExpenseReviewSheetProps {
  visible: boolean;
  onDismiss: () => void;
  expenses: Expense[];
  onApprove: (expenseId: string) => void;
  onReject: (expenseId: string, note: string) => void;
  /** The expense id currently in flight, if any — disables its own buttons
   * only (another row stays interactive). */
  submittingId?: string | null;
  /** The expense id whose most recent approve attempt hit
   * `ExpenseValidationError` (`reason: 'NO_MILEAGE_RATE'`). */
  mileageRateErrorId?: string | null;
  /** The expense id whose most recent approve/reject attempt hit a typed
   * 4xx refusal that ISN'T the recognised `NO_MILEAGE_RATE` arm (see the
   * module doc's GENERIC TYPED-ERROR ARM). */
  genericErrorId?: string | null;
  onSetRatePress?: () => void;
  testID?: string;
}

function ReviewCard({
  expense,
  onApprove,
  onReject,
  isSubmitting,
  showMileageRateError,
  showGenericError,
  onSetRatePress,
}: {
  expense: Expense;
  onApprove: () => void;
  onReject: (note: string) => void;
  isSubmitting: boolean;
  showMileageRateError: boolean;
  showGenericError: boolean;
  onSetRatePress?: () => void;
}) {
  const { t } = useTranslation('expenses');
  const [isRejecting, setIsRejecting] = useState(false);
  const [note, setNote] = useState('');

  const amountLabel =
    expense.kind === 'mileage'
      ? t('reviewSheet.milesValue', { miles: expense.miles })
      : formatMoney(expense.amount_minor ?? 0, expense.currency);

  return (
    <View
      testID={`expense-review-card-${expense.id}`}
      className="gap-2 rounded-cell bg-card p-4"
    >
      <Small className="text-muted-foreground">
        {formatEarningsSpanDate(expense.local_date)}
      </Small>
      <View className="flex-row items-baseline justify-between gap-3">
        <Body className="flex-1">{expense.description}</Body>
        <Body
          testID={`expense-review-card-${expense.id}-amount`}
          className="flex-shrink-0 font-medium"
          tabular
        >
          {amountLabel}
        </Body>
      </View>

      {showMileageRateError ? (
        <View className="gap-1">
          <Small
            testID={`expense-review-card-${expense.id}-mileage-error`}
            className="text-destructive"
          >
            {t('reviewSheet.noMileageRateError')}
          </Small>
          <Button
            testID={`expense-review-card-${expense.id}-set-rate`}
            variant="ghost"
            size="sm"
            onPress={onSetRatePress}
          >
            <Text className="text-foreground">
              {t('reviewSheet.setRateAction')}
            </Text>
          </Button>
        </View>
      ) : null}

      {showGenericError ? (
        // TODO(mobile): the API agent is deciding whether reviewing an
        // expense into an already-approved week is BLOCKED with a typed
        // error or the week is silently REOPENED (Finding 6). Once they
        // land it, branch on its `metadata.reason` here — same shape as
        // the NO_MILEAGE_RATE arm above — and swap this generic fallback
        // for copy naming the actual situation. Do not guess the code.
        <Small
          testID={`expense-review-card-${expense.id}-error`}
          className="text-destructive"
        >
          {t('reviewSheet.reviewFailedGeneric')}
        </Small>
      ) : null}

      {isRejecting ? (
        <View className="gap-2">
          <Textarea
            testID={`expense-review-card-${expense.id}-note-input`}
            accessibilityLabel={t('reviewSheet.noteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('reviewSheet.noteLabel')}
          />
          <Button
            testID={`expense-review-card-${expense.id}-send`}
            variant="destructive"
            disabled={isSubmitting}
            onPress={() => onReject(note.trim())}
          >
            <Text>{t('reviewSheet.sendButton')}</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-row gap-2">
          <Button
            testID={`expense-review-card-${expense.id}-approve`}
            disabled={isSubmitting}
            onPress={onApprove}
          >
            <Text>{t('reviewSheet.approveButton')}</Text>
          </Button>
          <Button
            testID={`expense-review-card-${expense.id}-reject`}
            variant="ghost"
            disabled={isSubmitting}
            onPress={() => setIsRejecting(true)}
          >
            <Text className="text-destructive">
              {t('reviewSheet.rejectButton')}
            </Text>
          </Button>
        </View>
      )}
    </View>
  );
}

export function ExpenseReviewSheet({
  visible,
  onDismiss,
  expenses,
  onApprove,
  onReject,
  submittingId = null,
  mileageRateErrorId = null,
  genericErrorId = null,
  onSetRatePress,
  testID = 'expense-review-sheet',
}: ExpenseReviewSheetProps) {
  const { t } = useTranslation('expenses');

  return (
    <BottomSheetBase
      sheetId="expense-review"
      visible={visible}
      onDismiss={onDismiss}
      testID={testID}
      fitContent
      showCloseButton
    >
      <View className="gap-4 px-6 pb-4">
        <H4>{t('reviewSheet.title')}</H4>
        <View className="gap-3">
          {expenses.map(expense => (
            <ReviewCard
              key={expense.id}
              expense={expense}
              isSubmitting={submittingId === expense.id}
              showMileageRateError={mileageRateErrorId === expense.id}
              showGenericError={genericErrorId === expense.id}
              onApprove={() => onApprove(expense.id)}
              onReject={note => onReject(expense.id, note)}
              onSetRatePress={onSetRatePress}
            />
          ))}
        </View>
      </View>
    </BottomSheetBase>
  );
}

export type { ExpenseReviewSheetProps };
