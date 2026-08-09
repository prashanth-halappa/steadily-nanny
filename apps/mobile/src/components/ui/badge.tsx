import * as Slot from '@rn-primitives/slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { View, type ViewProps } from 'react-native';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';

/** Vertical padding shared by Badge and StatusPill filled chips. */
const FILLED_CHIP_PADDING_Y = 'py-[5px]';

/** Inline borderRadius matching tailwind `rounded-chip` (Animated.View cannot use className). */
const CHIP_BORDER_RADIUS = 999;

const badgeVariants = cva(
  `web:inline-flex items-center rounded-chip px-3 ${FILLED_CHIP_PADDING_Y} web:transition-colors web:focus:outline-none web:focus:ring-2 web:focus:ring-ring web:focus:ring-offset-2`,
  {
    variants: {
      variant: {
        // No native `active:` pseudo-classes here: a badge is not pressable,
        // and an `active:` class on a plain View makes css-interop upgrade it
        // to a Pressable after first paint — the dev-only upgrade warning for
        // that crashed the whole screen (see GOLDEN-FIXES "Badge render
        // crash"). `web:hover:` variants are web-only and inert on native.
        default: 'border-transparent bg-primary web:hover:opacity-80',
        secondary: 'border-transparent bg-secondary web:hover:opacity-80',
        destructive: 'border-transparent bg-destructive web:hover:opacity-80',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const badgeTextVariants = cva('text-xs font-semibold ', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type BadgeProps = ViewProps & {
  asChild?: boolean;
} & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, asChild, ...props }: BadgeProps) {
  const Component = asChild ? Slot.View : View;
  return (
    <TextClassContext.Provider value={badgeTextVariants({ variant })}>
      <Component
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export type { BadgeProps };
export {
  Badge,
  badgeTextVariants,
  badgeVariants,
  CHIP_BORDER_RADIUS,
  FILLED_CHIP_PADDING_Y,
};
