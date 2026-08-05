/**
 * Field label — muted caption above a form control.
 * Uses the label typography token (14/21/500); do not add font-medium or text-xs
 * classNames — inline token styles win over NativeWind on typography components.
 */
import { cn } from '@/lib/utils';
import type { TypographyProps } from '@/src/components/ui/typography';
import { Label } from '@/src/components/ui/typography';

type FieldLabelProps = TypographyProps;

function FieldLabel({ className, children, ...props }: FieldLabelProps) {
  return (
    <Label className={cn('mb-1 text-muted-foreground', className)} {...props}>
      {children}
    </Label>
  );
}

export type { FieldLabelProps };
export { FieldLabel };
