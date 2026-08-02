/**
 * @module StatusPill
 *
 * Ledger status annotation for shifts/patterns — small-caps text label, not a
 * filled badge. `short-notice` and `outside-hours` are WARNINGS, not errors —
 * schedule conflicts warn and never block, so those two variants use the
 * muted ochre warning treatment, never destructive.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

/** Layout only — semantic colour lives on the text node. */
const statusPillVariants = cva(
  'flex-row items-center self-start rounded-chip px-2 py-0.5'
);

const statusPillTextVariants = cva(
  'font-semibold text-xs uppercase tracking-wide',
  {
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
  }
);

type StatusPillProps = VariantProps<typeof statusPillTextVariants> & {
  variant: NonNullable<VariantProps<typeof statusPillTextVariants>['variant']>;
  label: string;
  testID?: string;
};

export function StatusPill({ variant, label, testID }: StatusPillProps) {
  return (
    <View
      testID={testID}
      className={cn(statusPillVariants())}
      accessibilityRole="text"
    >
      <Text
        testID={testID ? `${testID}-label` : undefined}
        className={cn(statusPillTextVariants({ variant }))}
      >
        {label}
      </Text>
    </View>
  );
}

export type { StatusPillProps };
