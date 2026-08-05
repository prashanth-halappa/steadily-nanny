/**
 * @module StatusPill
 *
 * Daylight filled status pill for shifts/patterns — tinted container with
 * semibold label text. `short-notice` and `outside-hours` are WARNINGS, not
 * errors — schedule conflicts warn and never block, so those two variants use
 * the dedicated `shortNotice` hue (separate from `destructive`), never the
 * error treatment.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { FILLED_CHIP_PADDING_Y } from '@/src/components/ui/badge';
import { Text } from '@/src/components/ui/text';

const statusPillVariants = cva(
  `flex-row items-center self-start rounded-chip px-3 ${FILLED_CHIP_PADDING_Y}`,
  {
    variants: {
      variant: {
        confirmed: 'bg-success/15',
        pending: 'bg-warning/15',
        declined: 'bg-destructive/15',
        cancelled: 'bg-muted',
        'short-notice': 'bg-short-notice/15',
        'outside-hours': 'bg-short-notice/15',
      },
    },
    defaultVariants: { variant: 'pending' },
  }
);

const statusPillTextVariants = cva('font-semibold text-xs', {
  variants: {
    variant: {
      confirmed: 'text-success',
      pending: 'text-warning-strong',
      declined: 'text-destructive',
      cancelled: 'text-muted-foreground',
      'short-notice': 'text-short-notice-strong',
      'outside-hours': 'text-short-notice-strong',
    },
  },
  defaultVariants: { variant: 'pending' },
});

type StatusPillProps = VariantProps<typeof statusPillTextVariants> & {
  variant: NonNullable<VariantProps<typeof statusPillTextVariants>['variant']>;
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
