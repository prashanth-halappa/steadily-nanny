import { type Ref, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { cn } from '@/lib/utils';

interface InputProps extends Omit<TextInputProps, 'accessibilityLabel'> {
  accessibilityLabel: string;
  ref?: Ref<TextInput>;
  placeholderClassName?: string;
  /** When true, apply Daylight error-inline border (destructive). */
  error?: boolean;
}

function Input({
  className,
  placeholderClassName,
  accessibilityLabel,
  error = false,
  onFocus,
  onBlur,
  ref,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      {...props}
      className={cn(
        'web:flex h-10 native:h-12 web:w-full rounded-lg border bg-background px-3 web:py-2 text-base lg:text-sm native:text-lg native:leading-[1.25] text-foreground placeholder:text-muted-foreground web:ring-offset-background file:border-0 file:bg-transparent file:font-medium web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2',
        error ? 'border-destructive' : focused ? 'border-ring' : 'border-input',
        props.editable === false && 'opacity-50 web:cursor-not-allowed',
        className
      )}
      placeholderClassName={cn('text-muted-foreground', placeholderClassName)}
      onFocus={event => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={event => {
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}

export { Input };
