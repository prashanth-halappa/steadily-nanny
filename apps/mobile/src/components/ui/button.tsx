import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { Text, TextClassContext } from '@/src/components/ui/text';

const buttonVariants = cva(
  'group flex items-center justify-center rounded-button web:ring-offset-background web:transition-colors web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'bg-primary web:hover:opacity-90 active:bg-primary-dark disabled:bg-muted disabled:opacity-60',
        destructive:
          'bg-destructive web:hover:opacity-90 active:opacity-90 disabled:bg-muted disabled:opacity-60',
        outline:
          'border-1.5 border-border-strong bg-background web:hover:bg-accent web:hover:text-accent-foreground active:bg-accent disabled:border-muted-foreground/30 disabled:opacity-60',
        secondary:
          'bg-secondary web:hover:opacity-80 active:opacity-80 disabled:bg-muted disabled:opacity-60',
        ghost:
          'web:hover:bg-accent web:hover:text-accent-foreground active:bg-accent disabled:opacity-60',
        link: 'web:underline-offset-4 web:hover:underline web:focus:underline disabled:opacity-60',
      },
      size: {
        default: 'h-10 px-4 py-2 native:h-12 native:px-5 native:py-3',
        // native:h-12 meets spacing.minTouchTarget (44pt); bare h-9 is 36px.
        sm: 'h-9 rounded-button px-3 native:h-12 native:px-4',
        // min-h, not h: an L1 button's label carries times and can wrap —
        // a fixed height clips the second line instead of growing.
        lg: 'min-h-[44px] rounded-button px-8 py-2 native:min-h-[56px] native:py-3',
        icon: 'h-touch w-touch',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

const buttonTextVariants = cva(
  'web:whitespace-nowrap text-center text-sm native:text-base font-semibold text-foreground web:transition-colors',
  {
    variants: {
      variant: {
        default: 'text-primary-foreground group-disabled:text-muted-foreground',
        destructive:
          'text-destructive-foreground group-disabled:text-muted-foreground',
        outline:
          'group-active:text-accent-foreground group-disabled:text-muted-foreground',
        secondary:
          'text-secondary-foreground group-active:text-secondary-foreground group-disabled:text-muted-foreground',
        ghost:
          'group-active:text-accent-foreground group-disabled:text-muted-foreground',
        link: 'text-primary group-active:underline group-disabled:text-muted-foreground',
      },
      size: {
        default: '',
        sm: '',
        lg: 'native:text-lg',
        icon: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

type ButtonProps = React.ComponentPropsWithoutRef<typeof AnimatedPressable> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider
      value={buttonTextVariants({
        variant,
        size,
        className: 'web:pointer-events-none',
      })}
    >
      <AnimatedPressable
        className={cn(
          props.disabled && 'web:pointer-events-none',
          buttonVariants({ variant, size, className })
        )}
        role="button"
        haptic="light"
        scaleIntensity="standard"
        {...props}
      >
        {/* A bare string child would land inside a Pressable (a View) and be
            dropped by RN with "Text strings must be rendered within a <Text>
            component" — an invisible label. Wrap it here so the whole class of
            mistake can't recur; `Text` picks up TextClassContext, so it styles
            identically to an explicit <Text> child. */}
        {typeof children === 'string' ? <Text>{children}</Text> : children}
      </AnimatedPressable>
    </TextClassContext.Provider>
  );
}

export type { ButtonProps };
export { Button, buttonTextVariants, buttonVariants };
