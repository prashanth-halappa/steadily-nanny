import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { Card } from '@/src/components/ui/card';
import { spacing } from '~/lib/design-tokens/spacing';

/**
 * Minimum row height (Daylight) — generalises `ROW_MIN_HEIGHT` from
 * `settings.tsx`'s `SettingsNavRow`. Already clears the 44pt touch-target
 * floor, so pressable rows get that for free.
 */
export const ROW_MIN_HEIGHT = 52;

/**
 * One `Card tone="default"` wrapping N `ListRow`s — the card lifts, the rows
 * do not. Both `docs/design/screens-settings.md` §2.1 and
 * `docs/design/screens-pay-terms.md` §4.2 independently landed on this: eight
 * separately-lifted rows read as eight decisions, not one group.
 *
 * Rows are separated by a hairline inset 16px from the card's left edge —
 * the one deliberate exception to Daylight's "no list hairlines, separation
 * by light" rule, and only ever inside a grouped card, never on the page
 * ground. It's drawn HERE, between children, so the last row never gets one.
 */
function ListGroup({
  children,
  testID,
  className,
}: {
  children: React.ReactNode;
  testID?: string;
  className?: string;
}) {
  const rows = React.Children.toArray(children);
  return (
    <Card
      testID={testID}
      tone="default"
      className={cn('overflow-hidden p-0', className)}
    >
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: row order is a fixed list a caller passes in, not reorderable.
        <React.Fragment key={index}>
          {row}
          {index < rows.length - 1 && (
            <View
              testID="list-group-separator"
              className="ml-4 bg-border"
              style={{ height: StyleSheet.hairlineWidth }}
            />
          )}
        </React.Fragment>
      ))}
    </Card>
  );
}

/**
 * One row inside a `ListGroup`. No elevation and no rounded corners of its
 * own — the group clips and lifts for it. `left`/`right` are optional
 * icon/value slots either side of `children`.
 *
 * Row-internal type hierarchy: with no rule or shadow to lean on inside the
 * group, headline text should be at least 1.3x the sub-line size AND a clear
 * tonal step (e.g. an 18px `text-foreground` headline over a 13px
 * `text-muted-foreground` sub-line, `metadataLabel` — 18/13 ≈ 1.38x) — once
 * you remove rules, the type step has to carry the separation.
 */
function ListRow({
  children,
  left,
  right,
  onPress,
  testID,
}: {
  children?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const content = (
    <View
      className="flex-row items-center gap-3 px-4 py-3"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      {left}
      <View className="flex-1">{children}</View>
      {right}
    </View>
  );

  if (!onPress) {
    return <View testID={testID}>{content}</View>;
  }

  return (
    <AnimatedPressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      // `minHeight` already meets the 44pt target; the hit slop is the
      // forgiveness margin around it, so a row is still tappable when a
      // thumb lands just outside the painted bounds.
      hitSlop={8}
      style={{ minHeight: spacing.minTouchTarget }}
    >
      {content}
    </AnimatedPressable>
  );
}

export { ListGroup, ListRow };
