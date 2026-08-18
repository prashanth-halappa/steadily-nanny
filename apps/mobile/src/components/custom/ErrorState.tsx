/**
 * ErrorState — recovery-first error UI with variant presets.
 *
 * Pass `onRetry` to surface a retry button (wire it to a query refetch for an
 * effective auto-recovery loop). `variant` picks a sensible icon + default copy.
 *
 * Bare ground, no `Card` — an error is not a decision someone made, so it
 * never gets a decision's surface (never `tone="critical"`: that means "she
 * declined your terms", not "the network failed" — see `card.tsx`).
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
import { Button } from '@/src/components/ui/button';
import { IconChip } from '@/src/components/ui/icon-chip';
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
      <IconChip
        testID="error-state-icon"
        tone="brand"
        icon={VARIANT_ICONS[variant]}
      />
      <H3 className="mt-4 text-center">
        {title ?? t(`states.${variant}.title`)}
      </H3>
      <Body className="mt-2 text-center text-muted-foreground">
        {message ?? t(`states.${variant}.message`)}
      </Body>
      {onRetry ? (
        <Button
          testID="error-state-retry"
          variant="outline"
          className="mt-6"
          onPress={onRetry}
        >
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
