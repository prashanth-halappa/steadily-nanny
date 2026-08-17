/**
 * @module domains/expenses/components/ReimbursementsCard
 *
 * The weekly statement's Reimbursements section (TIER0-CX-SPEC.md §6.3/§7):
 * a card of its own, after the day rows and before actions, in BOTH role
 * views — visually and semantically separate from wages
 * (docs/11-MONEY.md §6). Not rendered at all when the week has no approved
 * expenses (§6.3 "Empty (no expenses this week): the card is not rendered
 * at all").
 *
 * `totalMinor` is the server-computed `earnings.reimbursements_minor` —
 * this component never re-derives the subtotal by summing
 * `approvedExpenses` itself, same "trust the server's total, render
 * verbatim" discipline `EarningsBreakdownSheet` already documents for
 * `gross_minor`.
 *
 * `totalMinor` is `number | null`, NEVER defaulted with `?? 0` at the call
 * site (Phase 3+4 adversarial review, finding 7): `reimbursements_minor`
 * only exists on the `ok` earnings arm. A `no_arrangement`, `currency_change`,
 * legacy `hours_only` week, or an earnings fetch error has no server total
 * at all — `?? 0` there would render a fabricated "£0.00" above real,
 * non-zero itemised amounts, exactly the silently-wrong zero
 * docs/11-MONEY.md §4 forbids. `null` renders `reimbursements.totalUnavailable`
 * instead — the items still list (they're real, independent of earnings),
 * only the SUBTOTAL is withheld.
 *
 * REIMBURSEMENT SETTLEMENTS ARE NOT PAYMENTS (attention spec §4.2, D20).
 * They are excluded from gross, from payable minutes and from the payment
 * ceiling (`earningsService.ts`) because they are the family repaying money
 * she already spent, not wages. Do not merge these tables, do not sum them
 * into paid-to-date. A settled reimbursement and a recorded payment look
 * like the same shape and are not the same fact — `settledOn` below comes
 * from `reimbursement_settlements`, never from the payments ledger.
 *
 * `onMarkReimbursedPress` is the whole role fork, exactly like
 * `PaidStateSection`'s `onMarkPaidPress`: the parent view supplies it, the
 * nanny view and a read-only helper omit it. Never a role check in here.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { InlineRetry } from '@/src/components/custom/InlineRetry';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { H4, MetadataLabel, Small } from '@/src/components/ui/typography';
import { AmountRow } from '@/src/domains/pay/components/AmountRow';
import {
  formatEarningsLongDate,
  formatEarningsSpanDate,
} from '@/src/domains/timesheet/utils/earningsFormat';
import { formatMoney } from '@/src/lib/money';
import { useElevation } from '~/lib/design-tokens/elevation';
import type { Expense } from '../types';

interface ReimbursementsCardProps {
  /** Approved expenses/mileage for the week ONLY — the caller filters;
   * a rejected or still-pending row must never reach this component (§8:
   * rejected rows are excluded from the subtotal). */
  approvedExpenses: Expense[];
  /** `earnings.reimbursements_minor` — the frozen/live server total, or
   * `null` when the week has no server total to show (see module doc). */
  totalMinor: number | null;
  currency: string;
  /** Whose reimbursements these are — the parent's multi-carer week needs
   * this above the itemised list; a nanny viewing her own card never passes
   * it. Not repeated per line — one caption under the title is enough. */
  carerName?: string;
  /** `settled_at` off this week's `reimbursement_settlement` row, or `null`
   * while the money has not gone back yet. A DATE, not an instant. */
  settledOn?: string | null;
  /** `amount_minor` off the same settlement row — may differ from the live
   * `totalMinor` when a race captured less than the approved total. When
   * absent, the state line falls back to date-only copy. */
  settledAmountMinor?: number | null;
  /** Supplied by the PARENT view only — its absence is what makes the card
   * read-only for the nanny and for a read-only helper. */
  onMarkReimbursedPress?: () => void;
  /** Held down while the settlement request is in flight. */
  isMarkReimbursedDisabled?: boolean;
  /** A refused settlement, stated under the button that caused it
   * (GOLDEN-FIXES #40 — never a toast). */
  markReimbursedError?: string | null;
  /** The settlement read FAILED or is still in flight — distinct from
   * "loaded, and it hasn't happened yet" (`settledOn === null` covers that
   * case too). A dropped read must never render "not reimbursed yet" over
   * money that may already be back with her
   * (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B) — the state line and "Mark
   * reimbursed" are both withheld and an inline retry stands in for the
   * state line. The itemised list and total above are UNAFFECTED — they
   * come from the (unrelated) expenses read, not the settlement one. */
  settlementUnknown?: boolean;
  /** Wired to the settlements query's own `refetch`. */
  onRetrySettlements?: () => void;
  testID?: string;
}

export function ReimbursementsCard({
  approvedExpenses,
  totalMinor,
  currency,
  carerName,
  settledOn = null,
  settledAmountMinor = null,
  onMarkReimbursedPress,
  isMarkReimbursedDisabled = false,
  markReimbursedError = null,
  settlementUnknown = false,
  onRetrySettlements,
  testID = 'reimbursements-card',
}: ReimbursementsCardProps) {
  const { t } = useTranslation('expenses');
  const elevation = useElevation();

  if (approvedExpenses.length === 0) return null;

  return (
    <View testID={testID} className="mt-4 gap-2">
      <MetadataLabel className="text-muted-foreground">
        {t('reimbursements.title')}
      </MetadataLabel>
      {carerName ? (
        <Small
          testID={`${testID}-carer-name`}
          className="text-muted-foreground"
        >
          {carerName}
        </Small>
      ) : null}

      {approvedExpenses.map(expense => (
        <View
          key={expense.id}
          className="rounded-row bg-card px-4 py-3"
          style={elevation.row}
        >
          <AmountRow
            testID={`${testID}-line-${expense.id}`}
            label={expense.description}
            value={
              expense.amount_minor !== null
                ? formatMoney(expense.amount_minor, currency)
                : null
            }
            subLine={formatEarningsSpanDate(expense.local_date)}
          />
        </View>
      ))}

      {totalMinor !== null ? (
        <View className="rounded-row bg-card px-4 py-3" style={elevation.row}>
          <View className="flex-row items-baseline justify-between gap-3">
            <H4>{t('reimbursements.totalLabel')}</H4>
            <H4 testID={`${testID}-total`} tabular>
              {formatMoney(totalMinor, currency)}
            </H4>
          </View>
        </View>
      ) : (
        <View
          testID={`${testID}-total-unavailable`}
          className="rounded-row bg-card px-4 py-3"
          style={elevation.row}
        >
          <Small className="text-muted-foreground">
            {t('reimbursements.totalUnavailable')}
          </Small>
        </View>
      )}

      {/* State words on the figure, both roles, always (docs/11-MONEY.md §1):
          a total with no state says nothing about whether she has her money
          back. Withheld entirely when the settlement read itself is unknown
          — see `settlementUnknown`'s doc. */}
      {settlementUnknown ? (
        <InlineRetry
          testID={`${testID}-settlement-retry`}
          message={t('reimbursements.settlementUnknown')}
          onRetry={onRetrySettlements ?? (() => {})}
        />
      ) : (
        <>
          <Small testID={`${testID}-state`} className="text-muted-foreground">
            {settledOn
              ? settledAmountMinor != null
                ? t('reimbursements.stateSettled', {
                    amount: formatMoney(settledAmountMinor, currency),
                    date: formatEarningsLongDate(settledOn),
                  })
                : t('reimbursements.stateSettledDateOnly', {
                    date: formatEarningsLongDate(settledOn),
                  })
              : t('reimbursements.stateUnsettled')}
          </Small>

          {onMarkReimbursedPress && !settledOn ? (
            <>
              <Button
                testID={`${testID}-mark-reimbursed-button`}
                variant="ghost"
                disabled={isMarkReimbursedDisabled}
                onPress={onMarkReimbursedPress}
              >
                <Text className="text-foreground">
                  {t('reimbursements.markReimbursedButton')}
                </Text>
              </Button>
              {markReimbursedError ? (
                <Small
                  testID={`${testID}-mark-reimbursed-error`}
                  className="text-destructive"
                >
                  {markReimbursedError}
                </Small>
              ) : null}
            </>
          ) : null}
        </>
      )}

      <Small testID={`${testID}-note`} className="text-muted-foreground">
        {t('reimbursements.note')}
      </Small>
    </View>
  );
}

export type { ReimbursementsCardProps };
