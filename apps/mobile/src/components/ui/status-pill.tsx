/**
 * @module StatusPill
 *
 * A pill-shaped status label for shifts/patterns. `short-notice` and
 * `outside-hours` are WARNINGS, not errors — the product rule is that
 * schedule conflicts warn and never block, so those two variants use the
 * warm amber warning treatment, never destructive red.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

const statusPillVariants = cva(
  'flex-row items-center self-start rounded-full px-3 py-1',
  {
    variants: {
      variant: {
        confirmed: 'bg-success/10',
        pending: 'bg-muted',
        declined: 'bg-destructive/10',
        cancelled: 'bg-muted',
        'short-notice': 'bg-warning/10',
        'outside-hours': 'bg-warning/10',
      },
    },
    defaultVariants: { variant: 'pending' },
  }
);

const statusPillTextVariants = cva('font-sora-semibold text-xs', {
  variants: {
    variant: {
      confirmed: 'text-success',
      pending: 'text-muted-foreground',
      declined: 'text-destructive',
      cancelled: 'text-muted-foreground',
      'short-notice': 'text-warning',
      'outside-hours': 'text-warning',
    },
  },
  defaultVariants: { variant: 'pending' },
});

type StatusPillProps = VariantProps<typeof statusPillVariants> & {
  variant: NonNullable<VariantProps<typeof statusPillVariants>['variant']>;
  label: string;
  testID?: string;
};

export function StatusPill({ variant, label, testID }: StatusPillProps) {
  return (
    <View
      testID={testID}
      className={cn(statusPillVariants({ variant }))}
      accessibilityRole="text"
    >
      <Text className={cn(statusPillTextVariants({ variant }))}>{label}</Text>
    </View>
  );
}

export type { StatusPillProps };
