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
import { useTranslation } from 'react-i18next';
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

const VARIANT_ICONS: Record<ErrorVariant, LucideIcon> = {
  network: WifiOff,
  server: ServerCrash,
  notFound: SearchX,
  auth: Lock,
  generic: AlertCircle,
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
  secondaryLabel,
}: ErrorStateProps) {
  const { t } = useTranslation('errors');
  const resolvedSecondaryLabel = secondaryLabel ?? t('goBack');

  return (
    <View
      testID="error-state"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <Icon
        icon={VARIANT_ICONS[variant]}
        size={40}
        className="text-muted-foreground"
      />
      <H3 className="mt-4 text-center">
        {title ?? t(`states.${variant}.title`)}
      </H3>
      <Body className="mt-2 text-center text-muted-foreground">
        {message ?? t(`states.${variant}.message`)}
      </Body>
      {onRetry ? (
        <Button className="mt-6" onPress={onRetry}>
          <Text>{t('tryAgain')}</Text>
        </Button>
      ) : null}
      {onSecondaryAction ? (
        <Button variant="ghost" className="mt-2" onPress={onSecondaryAction}>
          <Text>{resolvedSecondaryLabel}</Text>
        </Button>
      ) : null}
    </View>
  );
}
