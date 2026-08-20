/**
 * Inline field validation message — plain destructive text below a control.
 * For boxed auth/form failures use InlineError instead (errorInline tokens).
 */
import { cn } from '@/lib/utils';
import type { TypographyProps } from '@/src/components/ui/typography';
import { Caption } from '@/src/components/ui/typography';

type FieldErrorProps = TypographyProps;

function FieldError({ className, children, ...props }: FieldErrorProps) {
  if (children == null || children === '') return null;

  return (
    <Caption
      accessibilityRole="alert"
      className={cn('mt-2 text-error-inline-text', className)}
      {...props}
    >
      {children}
    </Caption>
  );
}

export type { FieldErrorProps };
export { FieldError };
