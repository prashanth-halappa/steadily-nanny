import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Body, H2 } from '@/src/components/ui/typography';

/** UI shown by RootErrorBoundary when the app crashes. */
export function RootErrorFallback({ onReset }: { onReset?: () => void }) {
  return (
    <View
      testID="root-error-fallback"
      className="flex-1 items-center justify-center bg-background px-6"
    >
      <H2 className="text-center">Something went wrong</H2>
      <Body className="mt-3 text-center text-muted-foreground">
        The app hit an unexpected error.
      </Body>
      {onReset ? (
        <Button className="mt-6" onPress={onReset}>
          <Text>Reload</Text>
        </Button>
      ) : null}
    </View>
  );
}
