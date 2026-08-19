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
 *
 * `onLabelPress` (§11.2) opens `TermsGlossarySheet` on the term this row
 * names — the only pressable label in the app, so the 1px dotted underline
 * is the whole affordance and must render whenever a handler is passed. A
 * label with no handler is unchanged: plain `Body`, no underline.
 */
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
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
  /** Opens the glossary entry this label names (§11.2). Omit for a row whose
   * label has no glossary entry — it renders as plain, unpressable text. */
  onLabelPress?: () => void;
}

export function AmountRow({
  testID,
  label,
  value,
  valueWhenNull,
  subLine,
  onLabelPress,
}: AmountRowProps) {
  const { t } = useTranslation('pay');
  // The glossary and its a11y hint live in the `hours` namespace (spec
  // §11.3), so the hint needs its own aliased hook rather than an
  // `hours:`-prefixed key — the locale-key guard's extractor reads the
  // literal argument and does not understand the prefix form.
  const { t: tHours } = useTranslation('hours');
  const colors = useThemeColors();
  const displayValue = value ?? valueWhenNull ?? t('notSet');

  const labelNode = onLabelPress ? (
    <Pressable
      testID={testID ? `${testID}-label` : undefined}
      onPress={onLabelPress}
      accessibilityRole="button"
      accessibilityHint={tHours('glossary.labelA11yHint')}
      hitSlop={8}
      className="shrink"
    >
      <Body
        className="text-foreground"
        style={{
          textDecorationLine: 'underline',
          textDecorationStyle: 'dotted',
          textDecorationColor: colors.mutedForeground,
        }}
      >
        {label}
      </Body>
    </Pressable>
  ) : (
    <Body className="shrink text-foreground">{label}</Body>
  );

  return (
    <View testID={testID} className="gap-1">
      <View className="flex-row items-baseline justify-between gap-3">
        {labelNode}
        <Body
          testID={testID ? `${testID}-value` : undefined}
          className="flex-1 text-right text-foreground"
          weight="medium"
          tabular
        >
          {displayValue}
        </Body>
      </View>
      {subLine ? (
        <Small
          testID={testID ? `${testID}-subline` : undefined}
          className="text-muted-foreground"
        >
          {subLine}
        </Small>
      ) : null}
    </View>
  );
}
