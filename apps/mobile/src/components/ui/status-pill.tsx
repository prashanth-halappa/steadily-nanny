/**
 * @module StatusPill
 *
 * Daylight filled status pill for shifts/patterns — tinted container with
 * semibold label text. `short-notice` and `outside-hours` are WARNINGS, not
 * errors — schedule conflicts warn and never block, so those two variants use
 * the dedicated `shortNotice` hue (separate from `destructive`), never the
 * error treatment.
 *
 * The pill SHRINKS and its label truncates to one line. RN defaults
 * `flexShrink: 0`, so without this a long label (a translated availability
 * status, say) pushes the pill past its card and off the screen edge rather
 * than ellipsising — `DAYLIGHT-UX-AUDIT.md` #29, which was overflow, not
 * truncation. `self-start` still keeps a short pill hugging its content.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';
import { cn } from '@/lib/utils';
import { FILLED_CHIP_PADDING_Y } from '@/src/components/ui/badge';
import { Text } from '@/src/components/ui/text';

const statusPillVariants = cva(
  `shrink flex-row items-center self-start rounded-chip px-3 ${FILLED_CHIP_PADDING_Y}`,
  {
    variants: {
      variant: {
        confirmed: 'bg-pill-success',
        pending: 'bg-pill-warning',
        declined: 'bg-pill-destructive',
        cancelled: 'bg-secondary',
        'short-notice': 'bg-pill-short-notice',
        'outside-hours': 'bg-pill-short-notice',
      },
    },
    defaultVariants: { variant: 'pending' },
  }
);

const statusPillTextVariants = cva('font-semibold text-xs', {
  variants: {
    variant: {
      confirmed: 'text-success-ink',
      pending: 'text-warning-ink',
      declined: 'text-error-inline-text',
      cancelled: 'text-muted-strong',
      'short-notice': 'text-short-notice-ink',
      'outside-hours': 'text-short-notice-ink',
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
        className={cn('shrink', statusPillTextVariants({ variant }))}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export type { StatusPillProps };
