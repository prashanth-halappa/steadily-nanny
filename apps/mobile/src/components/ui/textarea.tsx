import type * as React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { typography } from '@/lib/design-tokens/typography';
import { cn } from '@/lib/utils';

interface TextareaProps extends Omit<TextInputProps, 'accessibilityLabel'> {
  accessibilityLabel: string;
  ref?: React.RefObject<TextInput>;
  placeholderClassName?: string;
  multiline?: boolean;
  numberOfLines?: number;
}

function Textarea({
  className,
  multiline = true,
  numberOfLines = 4,
  placeholderClassName,
  style,
  accessibilityLabel,
  ...props
}: TextareaProps) {
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          fontSize: typography.body.size,
          lineHeight: typography.body.lineHeight,
          fontFamily: typography.body.fontFamily,
          letterSpacing: typography.body.letterSpacing,
        },
        style,
      ]}
      className={cn(
        'web:flex min-h-[80px] w-full rounded-2xl border border-input bg-background px-3 py-2 text-foreground web:ring-offset-background web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2',
        props.editable === false && 'opacity-50 web:cursor-not-allowed',
        className
      )}
      placeholderClassName={cn('text-muted-foreground', placeholderClassName)}
      multiline={multiline}
      numberOfLines={numberOfLines}
      textAlignVertical="top"
      {...props}
    />
  );
}

export { Textarea };
