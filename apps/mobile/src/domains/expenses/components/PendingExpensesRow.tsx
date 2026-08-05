/**
 * @module domains/expenses/components/PendingExpensesRow
 *
 * The parent's "N expenses to review" affordance (TIER0-CX-SPEC.md §6.2),
 * rendered in `ParentWeekView`'s footer above the approve/query actions.
 * Not rendered at all when there are no pending rows.
 *
 * MONEY TOTAL, WHEN SAFE TO SHOW (Phase 3+4 adversarial review, finding 12):
 * a pending MILEAGE row's `amount_minor` is `null` by DB constraint until
 * approval (owner ruling, TIER0-CX-SPEC.md §6.2: "Pending mileage shows
 * MILES ONLY, never an indicative amount") — it is computed and frozen
 * only at approval. The OLD code summed `amount_minor ?? 0`, which for an
 * all-mileage pending set produced "2 claims · £0.00": a fabricated figure
 * for claims that will definitely pay out. The fix: a money total renders
 * ONLY when there is at least one priced (`expense`-kind) row AND every
 * priced row shares one currency (this list is `usePendingExpenses` —
 * HOUSEHOLD-WIDE, not week-scoped — so it can legitimately span weeks with
 * different currencies after a mid-year currency change). Otherwise no
 * total renders at all; a "N with mileage to price" note fills in instead
 * of a misleading single-currency label.
 */
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Body, Small } from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import { useElevation } from '~/lib/design-tokens/elevation';
import type { Expense } from '../types';

interface PendingExpensesRowProps {
  pendingExpenses: Expense[];
  onPress: () => void;
  testID?: string;
}

export function PendingExpensesRow({
  pendingExpenses,
  onPress,
  testID = 'expenses-pending-row',
}: PendingExpensesRowProps) {
  const { t } = useTranslation('expenses');
  const elevation = useElevation();

  if (pendingExpenses.length === 0) return null;

  const pricedExpenses = pendingExpenses.filter(
    expense => expense.amount_minor !== null
  );
  const unpricedCount = pendingExpenses.length - pricedExpenses.length;
  const pricedCurrencies = new Set(pricedExpenses.map(e => e.currency));
  // Safe to sum only when there's something priced AND it's all one
  // currency — never guess a total across mixed currencies, never invent
  // one for an all-mileage set.
  const canShowTotal = pricedExpenses.length > 0 && pricedCurrencies.size === 1;
  const totalMinor = pricedExpenses.reduce(
    (sum, expense) => sum + (expense.amount_minor ?? 0),
    0
  );
  const [singleCurrency] = pricedCurrencies;
  const amountLabel =
    canShowTotal && singleCurrency
      ? formatMoney(totalMinor, singleCurrency)
      : null;
  const showMixedCurrencyNote =
    !canShowTotal && pricedExpenses.length > 0 && pricedCurrencies.size > 1;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="mt-4 gap-1 rounded-row bg-card px-4 py-3"
      style={elevation.row}
    >
      <View className="flex-row items-center justify-between gap-3">
        <Body className="flex-1">
          {t('pendingRow.count', { count: pendingExpenses.length })}
        </Body>
        {amountLabel !== null ? (
          <Body testID={`${testID}-amount`} className="flex-shrink-0" tabular>
            {amountLabel}
          </Body>
        ) : null}
        <Icon icon={ChevronRight} size={20} className="text-muted-foreground" />
      </View>
      {showMixedCurrencyNote ? (
        <Small
          testID={`${testID}-mixed-currency-note`}
          className="text-muted-foreground"
        >
          {t('pendingRow.mixedCurrencies')}
        </Small>
      ) : unpricedCount > 0 ? (
        <Small
          testID={`${testID}-mileage-note`}
          className="text-muted-foreground"
        >
          {t('pendingRow.mileageToPrice', { count: unpricedCount })}
        </Small>
      ) : null}
    </Pressable>
  );
}

export type { PendingExpensesRowProps };
