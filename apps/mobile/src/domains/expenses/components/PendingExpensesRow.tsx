/**
 * @module domains/expenses/components/PendingExpensesRow
 *
 * The parent's "N expenses to review" affordance (TIER0-CX-SPEC.md §6.2),
 * rendered in `ParentWeekView`'s footer above the approve/query actions.
 * Not rendered at all when there are no pending rows.
 *
 * The amount summed into the label only ever counts `expense`-kind rows'
 * `amount_minor` — a pending MILEAGE row's amount is `null` by DB
 * constraint until approval (owner ruling, TIER0-CX-SPEC.md §6.2: "Pending
 * mileage shows MILES ONLY, never an indicative amount"), so it
 * contributes nothing to this figure rather than being silently priced
 * ahead of the parent's actual approval.
 */
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Body } from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import { useElevation } from '~/lib/design-tokens/elevation';
import type { Expense } from '../types';

interface PendingExpensesRowProps {
  pendingExpenses: Expense[];
  currency: string;
  onPress: () => void;
  testID?: string;
}

export function PendingExpensesRow({
  pendingExpenses,
  currency,
  onPress,
  testID = 'expenses-pending-row',
}: PendingExpensesRowProps) {
  const { t } = useTranslation('expenses');
  const elevation = useElevation();

  if (pendingExpenses.length === 0) return null;

  const knownAmountMinor = pendingExpenses.reduce(
    (sum, expense) => sum + (expense.amount_minor ?? 0),
    0
  );
  const amountLabel = formatMoney(knownAmountMinor, currency);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="mt-4 flex-row items-center justify-between gap-3 rounded-row bg-card px-4 py-3"
      style={elevation.row}
    >
      <Body className="flex-1">
        {t('pendingRow.count', { count: pendingExpenses.length })}
      </Body>
      <Body testID={`${testID}-amount`} className="flex-shrink-0" tabular>
        {amountLabel}
      </Body>
      <Icon icon={ChevronRight} size={20} className="text-muted-foreground" />
    </Pressable>
  );
}

export type { PendingExpensesRowProps };
