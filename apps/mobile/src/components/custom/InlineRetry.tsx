/**
 * @module components/custom/InlineRetry
 *
 * A compact "we couldn't load this" line plus a retry button, for a SECTION
 * that has degraded independently of the screen around it — a failed or
 * still-in-flight read whose absence must never render as a fabricated fact
 * (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B). Renders no card, no ground:
 * the caller places it inline where the withheld content would have gone.
 */
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Small } from '@/src/components/ui/typography';

interface InlineRetryProps {
  message: string;
  onRetry: () => void;
  testID?: string;
}

export function InlineRetry({
  message,
  onRetry,
  testID = 'inline-retry',
}: InlineRetryProps) {
  const { t } = useTranslation('errors');

  return (
    <View testID={testID} className="gap-2">
      <Small className="text-muted-foreground">{message}</Small>
      <Button
        testID={`${testID}-button`}
        variant="secondary"
        size="sm"
        className="self-start"
        onPress={onRetry}
      >
        <Text>{t('tryAgain')}</Text>
      </Button>
    </View>
  );
}

export type { InlineRetryProps };
