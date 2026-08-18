import type * as React from 'react';
import { Text, type TextProps, View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';
import { useElevation } from '~/lib/design-tokens/elevation';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

export type CardTone =
  | 'default'
  | 'attention'
  | 'live'
  | 'positive'
  | 'critical';

/**
 * Daylight separates surfaces with soft plum-tinted shadow and NO border —
 * that inversion is the whole point of the direction (Ledger did the opposite:
 * hairline rule, zero elevation). If the shadow ever reads too faint on a
 * device, the hairline comes back HERE, once, not per call site.
 *
 * `tone` picks the card's surface + elevation tier:
 * - `default` — `bg-card` class, plain `card` elevation (unchanged).
 * - `attention` — opaque `surfaceAttention` ground, `cardProminent` elevation.
 * - `live` — apricot `liveCardBackground` ground, apricot `liveCard` elevation.
 * - `positive` — opaque `surfacePositive` ground, plain `card` elevation.
 * - `critical` — opaque `surfaceCritical` ground, plain `card` elevation.
 *   Means "an agreement was declined" — a state a person CHOSE. Never use
 *   this for a network or loading failure; that's `ErrorState`, no card.
 *
 * No accent bar — tried as a 4px inset colour stripe on `tone="attention"`,
 * removed after user feedback on device ("you don't need the left border").
 * It also had a genuine rendering defect (a 4px-wide element can't carry a
 * 20px corner radius; the radius degenerates and the bar poked past the
 * card's rounded corners), which is further reason not to reintroduce it.
 * The tinted ground alone does the tiering work.
 */
function Card({
  className,
  style,
  live = false,
  tone,
  children,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
  /** @deprecated use `tone="live"` instead. Ignored when `tone` is set. */
  live?: boolean;
  tone?: CardTone;
}) {
  const elevation = useElevation();
  const colors = useThemeColors();
  const resolvedTone: CardTone = tone ?? (live ? 'live' : 'default');

  const toneBackground: string | undefined =
    resolvedTone === 'attention'
      ? colors.surfaceAttention
      : resolvedTone === 'positive'
        ? colors.surfacePositive
        : resolvedTone === 'critical'
          ? colors.surfaceCritical
          : resolvedTone === 'live'
            ? elevation.liveCardBackground
            : undefined;

  const toneElevation =
    resolvedTone === 'attention'
      ? elevation.cardProminent
      : resolvedTone === 'live'
        ? elevation.liveCard
        : elevation.card;

  return (
    <View
      className={cn('rounded-card bg-card', className)}
      style={[
        toneElevation,
        toneBackground ? { backgroundColor: toneBackground } : null,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

function CardHeader({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <View
      className={cn('flex flex-col space-y-1.5 p-5.5', className)}
      {...props}
    />
  );
}

function CardTitle({
  className,
  ...props
}: TextProps & {
  ref?: React.RefObject<Text>;
}) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn(
        'text-2xl text-card-foreground font-semibold leading-none tracking-tight',
        className
      )}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: TextProps & {
  ref?: React.RefObject<Text>;
}) {
  return (
    <Text
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardContent({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View className={cn('p-5.5', className)} {...props} />
    </TextClassContext.Provider>
  );
}

function CardFooter({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <View
      className={cn('flex flex-row items-center p-5.5 pt-0', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
