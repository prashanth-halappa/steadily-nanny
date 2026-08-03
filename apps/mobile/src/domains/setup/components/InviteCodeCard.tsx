/**
 * @module domains/setup/components/InviteCodeCard
 *
 * Presentational invite-code display (code box + error/retry), extracted
 * out of `InviteScreen` so both the wizard and the settings entry point
 * (`ManageInviteScreen`) render identical UI. Deliberately holds no mutation
 * state of its own — both callers wait for an explicit "Generate" tap (see
 * InviteScreen's header for why the wizard no longer auto-fires on mount),
 * so `code`/`isError`/`onRetry` are passed in.
 */
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
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
    <Card className="items-center gap-4 p-5.5">
      {code ? (
        <Text
          testID="invite-code-value"
          selectable
          className="font-bold text-3xl tracking-widest text-primary"
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
    </Card>
  );
}
