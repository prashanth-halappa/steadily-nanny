/**
 * @module domains/setup/components/InviteCodeCard
 *
 * Presentational invite-code display (code box + error/retry), extracted
 * out of `InviteScreen` so both the wizard and the settings entry point
 * (`ManageInviteScreen`) render identical UI. Deliberately holds no mutation
 * state of its own — the two callers generate a code differently (the
 * wizard auto-fires on mount; the settings screen waits for an explicit
 * tap), so `code`/`isError`/`onRetry` are passed in.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body } from '@/src/components/ui/typography';

interface InviteCodeCardProps {
  code: string | null;
  isError: boolean;
  onRetry: () => void;
}

export function InviteCodeCard({
  code,
  isError,
  onRetry,
}: InviteCodeCardProps) {
  const { t } = useTranslation('household');

  return (
    <View className="items-center gap-4 rounded-2xl border border-border bg-card p-6">
      {code ? (
        <Text
          testID="invite-code-value"
          selectable
          className="font-sora-bold text-3xl tracking-widest text-primary"
        >
          {code}
        </Text>
      ) : (
        <LoadingIndicator />
      )}
      {isError ? (
        <>
          <Body className="text-center text-destructive">
            {t('invite.errorTitle')}
          </Body>
          <Button
            testID="invite-retry-button"
            variant="outline"
            onPress={onRetry}
          >
            <Text>{t('invite.retryButton')}</Text>
          </Button>
        </>
      ) : null}
    </View>
  );
}
