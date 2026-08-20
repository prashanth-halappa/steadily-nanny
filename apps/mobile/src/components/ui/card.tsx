import type * as React from 'react';
import { type Text as RNText, type TextProps, View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';
import { H4, Small } from '@/src/components/ui/typography';
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
 *
 * `provisional` — dashed = waiting on the other person. Swaps the elevation
 * shadow for a dashed `borderStrong` outline; same radius/padding, no other
 * change. Use it for a card whose subject hasn't happened yet from this
 * device's point of view (an invite nobody's redeemed, terms nobody's
 * accepted) — never for a state this side already settled.
 */
function Card({
  className,
  style,
  live = false,
  tone,
  provisional = false,
  children,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
  /** @deprecated use `tone="live"` instead. Ignored when `tone` is set. */
  live?: boolean;
  tone?: CardTone;
  /** Dashed border, no shadow — "waiting on the other person" (00-FOUNDATIONS §5.4). */
  provisional?: boolean;
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
            ? colors.surfaceLive
            : undefined;

  const toneElevation =
    resolvedTone === 'attention'
      ? elevation.cardProminent
      : resolvedTone === 'live'
        ? elevation.liveCard
        : elevation.card;

  return (
    <View
      className={cn(
        'rounded-card bg-card',
        provisional && 'border-1.5 border-dashed border-border-strong',
        className
      )}
      style={[
        provisional ? null : toneElevation,
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
      className={cn('flex flex-col space-y-1.5 p-4', className)}
      {...props}
    />
  );
}

function CardTitle({
  className,
  ...props
}: TextProps & {
  ref?: React.RefObject<RNText>;
}) {
  return (
    <H4
      role="heading"
      aria-level={3}
      className={cn('text-foreground tracking-tight', className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: TextProps & {
  ref?: React.RefObject<RNText>;
}) {
  return <Small className={cn('text-muted-strong', className)} {...props} />;
}

function CardContent({
  className,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
}) {
  return (
    <TextClassContext.Provider value="text-foreground">
      <View className={cn('p-4', className)} {...props} />
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
      className={cn('flex flex-row items-center p-4 pt-0', className)}
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
