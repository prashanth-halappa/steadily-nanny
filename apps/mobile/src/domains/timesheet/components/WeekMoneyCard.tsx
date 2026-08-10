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
import { Card, CardContent } from '@/src/components/ui/card';
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
}: WeekMoneyCardProps) {
  const earningsKind = weekEarningsSectionKind({
    earnings,
    totalMinutes,
    earningsError,
  });
  const showPaidState = hasPaidStateContent(paidState, payments);

  if (earningsKind === 'none' && !showPaidState) return null;

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
