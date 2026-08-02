import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H2 } from '@/src/components/ui/typography';

/** UI shown by RootErrorBoundary when the app crashes. */
export function RootErrorFallback({ onReset }: { onReset?: () => void }) {
  const { t } = useTranslation('common');

  return (
    <View
      testID="root-error-fallback"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <H2 className="text-center">{t('rootError.title')}</H2>
      <Body className="mt-3 text-center text-muted-foreground">
        {t('rootError.body')}
      </Body>
      {onReset ? (
        <Button className="mt-6" onPress={onReset}>
          <Text>{t('rootError.reload')}</Text>
        </Button>
      ) : null}
    </View>
  );
}
