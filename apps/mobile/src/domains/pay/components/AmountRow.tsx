/**
 * @module domains/pay/components/AmountRow
 *
 * One label/value line on a pay-terms card (TIER0-CX-SPEC.md §1 shared
 * primitives). `value: null` renders `valueWhenNull` — "Not set" by default
 * (the correct copy for a null term: a statement of the agreement, never a
 * nag), except the cancellations row, which passes its own "No cancellation
 * pay" — an explicit agreement, not a missing one, never "Not set".
 *
 * No hairline divider (Daylight separates by light, not rule) — a
 * subtotal/total row gets `rounded-cell bg-muted` instead, which is a
 * different component (`WeekEarningsLine`'s total row, Phase 2), not this one.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Body, Small } from '@/src/components/ui/typography';

interface AmountRowProps {
  testID?: string;
  label: string;
  value: string | null;
  /** Overrides the default "Not set" copy — only the cancellations row uses
   * this (TIER0-CX-SPEC.md §2). */
  valueWhenNull?: string;
  /** Second line — the derivation, e.g. "12h 30m at £18.50". */
  subLine?: string;
}

export function AmountRow({
  testID,
  label,
  value,
  valueWhenNull,
  subLine,
}: AmountRowProps) {
  const { t } = useTranslation('pay');
  const displayValue = value ?? valueWhenNull ?? t('notSet');

  return (
    <View testID={testID} className="gap-1">
      <View className="flex-row items-baseline justify-between gap-3">
        <Body className="flex-1 text-foreground">{label}</Body>
        <Body
          testID={testID ? `${testID}-value` : undefined}
          className="font-medium text-foreground"
          tabular
        >
          {displayValue}
        </Body>
      </View>
      {subLine ? (
        <Small className="text-muted-foreground">{subLine}</Small>
      ) : null}
    </View>
  );
}
