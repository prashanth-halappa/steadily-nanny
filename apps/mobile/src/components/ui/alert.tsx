import { cva, type VariantProps } from 'class-variance-authority';
import { useTheme } from 'expo-router/react-navigation';
import type { LucideIcon } from 'lucide-react-native';
import type * as React from 'react';
import { View, type ViewProps } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

const alertVariants = cva(
  'relative bg-background w-full rounded-lg border border-border p-4',
  {
    variants: {
      variant: {
        default: '',
        destructive: 'border-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Alert({
  className,
  variant,
  children,
  icon: IconComponent,
  iconSize = 16,
  iconClassName,
  ...props
}: ViewProps &
  VariantProps<typeof alertVariants> & {
    ref?: React.RefObject<View>;
    icon: LucideIcon;
    iconSize?: number;
    iconClassName?: string;
  }) {
  const { colors } = useTheme();
  return (
    <View
      role="alert"
      className={alertVariants({ variant, className })}
      {...props}
    >
      <View className="absolute left-3.5 top-4 -translate-y-0.5">
        <Icon
          icon={IconComponent}
          size={iconSize}
          color={String(
            variant === 'destructive' ? colors.notification : colors.text
          )}
        />
      </View>
      {children}
    </View>
  );
}

function AlertTitle({
  className,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      className={cn(
        'pl-7 mb-1 font-medium text-base leading-none tracking-tight text-foreground',
        className
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<typeof Text>) {
  return (
    <Text
      className={cn('pl-7 text-sm leading-relaxed text-foreground', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
