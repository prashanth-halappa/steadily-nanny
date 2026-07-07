/**
 * ErrorState — recovery-first error UI with variant presets.
 *
 * Pass `onRetry` to surface a retry button (wire it to a query refetch for an
 * effective auto-recovery loop). `variant` picks a sensible icon + default copy.
 */

import type { LucideIcon } from 'lucide-react-native';
import {
  AlertCircle,
  Lock,
  SearchX,
  ServerCrash,
  WifiOff,
} from 'lucide-react-native';
import { View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H3 } from '@/src/components/ui/typography';

export type ErrorVariant =
  | 'network'
  | 'server'
  | 'notFound'
  | 'auth'
  | 'generic';

interface VariantConfig {
  icon: LucideIcon;
  title: string;
  message: string;
}

const VARIANTS: Record<ErrorVariant, VariantConfig> = {
  network: {
    icon: WifiOff,
    title: 'No connection',
    message: 'Check your internet connection and try again.',
  },
  server: {
    icon: ServerCrash,
    title: 'Something went wrong',
    message: 'We hit a snag on our end. Please try again.',
  },
  notFound: {
    icon: SearchX,
    title: 'Not found',
    message: "We couldn't find what you were looking for.",
  },
  auth: {
    icon: Lock,
    title: 'Session expired',
    message: 'Please sign in again to continue.',
  },
  generic: {
    icon: AlertCircle,
    title: 'Something went wrong',
    message: 'Please try again.',
  },
};

interface ErrorStateProps {
  variant?: ErrorVariant;
  title?: string;
  message?: string;
  onRetry?: () => void;
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
}

export function ErrorState({
  variant = 'generic',
  title,
  message,
  onRetry,
  onSecondaryAction,
  secondaryLabel = 'Go back',
}: ErrorStateProps) {
  const config = VARIANTS[variant];
  return (
    <View
      testID="error-state"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <Icon icon={config.icon} size={40} className="text-muted-foreground" />
      <H3 className="mt-4 text-center">{title ?? config.title}</H3>
      <Body className="mt-2 text-center text-muted-foreground">
        {message ?? config.message}
      </Body>
      {onRetry ? (
        <Button className="mt-6" onPress={onRetry}>
          <Text>Try again</Text>
        </Button>
      ) : null}
      {onSecondaryAction ? (
        <Button variant="ghost" className="mt-2" onPress={onSecondaryAction}>
          <Text>{secondaryLabel}</Text>
        </Button>
      ) : null}
    </View>
  );
}
