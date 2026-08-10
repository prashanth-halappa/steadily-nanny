/**
 * @module domains/timesheet/components/WeekMoneyCard
 *
 * The Hours statement's fourth block (docs/design/screens-hours.md §5): what
 * the week is worth, and whether it has been paid — ONE L3 card. The gross
 * used to be the ninth band inside `WeekTotal` and the paid state a separate
 * footer card below the day rows and the reimbursements, so the two halves
 * of a single question ("what am I owed, and did it arrive?") sat a screen
 * apart. Separation inside the card is a gap, never a divider.
 *
 * The card DISAPPEARS when neither half has anything true to say — an empty
 * white rectangle on a money screen reads as a figure that failed to load.
 * Both halves publish their own emptiness predicate
 * (`weekEarningsSectionKind`, `hasPaidStateContent`), so this component
 * never re-derives either cascade.
 *
 * Reimbursements are NOT wages (`docs/11-MONEY.md` §6) and stay in their own
 * card, below. That separation is deliberate and is not a layout accident.
 */
import type { Payment } from '@steadily-nanny/shared-types/schemas/payment.schema';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Caption } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import { formatMoney } from '@/src/lib/money';
import type { TimesheetStatus, WeekEarningsStateResult } from '../types';
import type { WeekPaidState } from '../utils/paidState';
import { hasPaidStateContent, PaidStateSection } from './PaidStateSection';
import type { EarningsRole } from './WeekEarningsLine';
import { WeekEarningsLine, weekEarningsSectionKind } from './WeekEarningsLine';

interface WeekMoneyCardProps {
  testID?: string;
  earnings: WeekEarningsStateResult | null;
  timesheetStatus: TimesheetStatus | null | undefined;
  viewerRole: EarningsRole;
  carerId: string | null;
  carerDisplayName: string;
  carerName?: string | null;
  totalMinutes: number;
  earningsError?: boolean;
  onRetryEarnings?: () => void;
  onPressBreakdown?: () => void;
  /** Settlement is only fetched for an approved or reopened week; `null`
   * paid state means "no server gross", not "nothing paid". */
  paidState: WeekPaidState | null;
  payments: Payment[];
  settlementCurrency: string;
  /** PARENT view only — its absence is the read-only contract. */
  onMarkPaidPress?: () => void;
  isMarkPaidDisabled?: boolean;
  /** The parent's STAGED approval-time adjustment — decided but not yet sent,
   * so it is deliberately NOT inside the estimated gross above it (the
   * caption below the row says so). `null` when nothing is staged. */
  adjustment?: { amountMinor: number; note: string; currency: string } | null;
  /** PARENT view only, same read-only contract as `onMarkPaidPress`: without
   * a handler the row is inert and the "Add an adjustment" affordance never
   * renders at all. */
  onAdjustmentPress?: () => void;
}

export function WeekMoneyCard({
  testID = 'hours-money-card',
  earnings,
  timesheetStatus,
  viewerRole,
  carerId,
  carerDisplayName,
  carerName = null,
  totalMinutes,
  earningsError = false,
  onRetryEarnings,
  onPressBreakdown,
  paidState,
  payments,
  settlementCurrency,
  onMarkPaidPress,
  isMarkPaidDisabled = false,
  adjustment = null,
  onAdjustmentPress,
}: WeekMoneyCardProps) {
  const { t } = useTranslation('hours');
  const earningsKind = weekEarningsSectionKind({
    earnings,
    totalMinutes,
    earningsError,
  });
  const showPaidState = hasPaidStateContent(paidState, payments);
  // Third predicate on the disappear guard: a card whose only content is the
  // adjustment (staged, or the affordance to stage one) still has something
  // true to say, and must not vanish along with the two original halves.
  const showAdjustment = adjustment !== null || onAdjustmentPress !== undefined;

  if (earningsKind === 'none' && !showPaidState && !showAdjustment) return null;

  return (
    <Card testID={testID} className="mb-4">
      <CardContent className="gap-4">
        {earningsKind === 'none' ? null : (
          <WeekEarningsLine
            earnings={earnings}
            timesheetStatus={timesheetStatus}
            viewerRole={viewerRole}
            carerId={carerId}
            carerDisplayName={carerDisplayName}
            carerName={carerName}
            totalMinutes={totalMinutes}
            earningsError={earningsError}
            onRetryEarnings={onRetryEarnings}
            onPress={onPressBreakdown}
          />
        )}
        {/* Between the gross and the settlement, NOT inside
            `WeekEarningsLine` — that component's four early returns would
            swallow it on exactly the degraded weeks where a parent is most
            likely to want an adjustment. */}
        {adjustment ? (
          <Pressable
            testID={`${testID}-adjustment`}
            accessibilityRole={onAdjustmentPress ? 'button' : undefined}
            disabled={!onAdjustmentPress}
            onPress={onAdjustmentPress}
            className="gap-1"
          >
            <AmountRow
              testID={`${testID}-adjustment-row`}
              label={t('adjustment.rowLabel')}
              value={formatMoney(adjustment.amountMinor, adjustment.currency)}
              subLine={adjustment.note}
            />
            {/* Load-bearing: the staged figure is NOT in the estimated gross
                above, and a parent reading two numbers that don't add up
                deserves to be told which one is waiting. */}
            <Caption className="text-muted-foreground">
              {t('adjustment.stagedNote')}
            </Caption>
          </Pressable>
        ) : onAdjustmentPress ? (
          <Button
            testID={`${testID}-add-adjustment`}
            variant="ghost"
            size="sm"
            className="self-start"
            onPress={onAdjustmentPress}
          >
            <Text>{t('adjustment.addButton')}</Text>
          </Button>
        ) : null}
        <PaidStateSection
          paidState={paidState}
          payments={payments}
          currency={settlementCurrency}
          onMarkPaidPress={onMarkPaidPress}
          isMarkPaidDisabled={isMarkPaidDisabled}
        />
      </CardContent>
    </Card>
  );
}

export type { WeekMoneyCardProps };
