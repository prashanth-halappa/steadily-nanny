import type * as React from 'react';
import { Text, type TextProps, View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';
import { useElevation } from '~/lib/design-tokens/elevation';

/**
 * Daylight separates surfaces with soft plum-tinted shadow and NO border —
 * that inversion is the whole point of the direction (Ledger did the opposite:
 * hairline rule, zero elevation). If the shadow ever reads too faint on a
 * device, the hairline comes back HERE, once, not per call site.
 *
 * `live` swaps the neutral shadow for the apricot one. Pass it wherever the
 * screen is also showing the Today wash, so the card carries the signal and
 * the wash echoes it.
 */
function Card({
  className,
  style,
  live = false,
  ...props
}: ViewProps & {
  ref?: React.RefObject<View>;
  live?: boolean;
}) {
  const elevation = useElevation();
  return (
    <View
      className={cn('rounded-card bg-card', className)}
      style={[
        live ? elevation.liveCard : elevation.card,
        live ? { backgroundColor: elevation.liveCardBackground } : null,
        style,
      ]}
      {...props}
    />
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
      <View className={cn('p-5.5 pt-0', className)} {...props} />
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
